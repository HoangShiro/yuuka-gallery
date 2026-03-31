import copy
import random
import threading
import time
from typing import Optional, Dict, List, Tuple, Any

from ..world_generator import (
    BUILDING_FOOTPRINTS,
    BUILDING_SIZES,
    FIXED_CAPACITY,
    WorldGenerator,
    generate_world,
)
from .config import export_config_view, normalize_engine_config
from .constants import (
    ACTIVITY_DURATION_WORLD_HOURS,
    ACTIVITY_LOCATION_TYPES,
    ACTIVITY_NEED_REDUCTION,
    DEFAULT_ACTIVITY_DURATION_WORLD_HOURS,
    DEFAULT_CONFIG,
    DEFAULT_SIMULATION_SPEED,
    FAST_TRAVEL_THRESHOLD,
    FOOD_PRICES,
    JOB_CAPACITY_BY_TYPE,
    LOCATION_INTERACTION_COOLDOWN_TICKS,
    NEED_INCREASE_RATE,
    NEED_TO_ACTIVITY,
    ROAD_INTERACTION_COOLDOWN_TICKS,
    ROAD_INTERACTION_DISTANCE_PX,
    ROAD_INTERACTION_RELATIONSHIP_BOOST,
    ROAD_INTERACTION_SOCIAL_BOOST,
    RUN_NEED_THRESHOLD,
    RUN_SPEED_PX_PER_SEC,
    TIME_BASED_NEED_MULTIPLIER,
    WALK_SPEED_PX_PER_SEC,
    WORK_DURATIONS,
    WORK_WAGES,
    WORLD_SECONDS_PER_REAL_SECOND_AT_X1,
    ZODIAC_COMPATIBILITY,
)
from .constants_social import (
    NEW_NEEDS,
    NEED_PERSONALITY_MODIFIERS,
    CHAOS_FACTOR_CONFIG,
)
from .state_engine_time_skip import TimeSkipMixin
from .indexing import build_location_index, calc_world_time
from .npc_state import build_npcs_from_spawns, build_single_npc, migrate_npc_to_new_schema
from .street_router import build_street_router
from .relationship_engine import RelationshipEngine
from .memory_engine import MemoryEngine
from .mood_engine import MoodEngine
from .social_dynamics import SocialDynamicsEngine


def _point_distance(left, right):
    return ((left["x"] - right["x"]) ** 2 + (left["y"] - right["y"]) ** 2) ** 0.5


def _point_on_polyline(points, progress_px):
    if not points:
        return None
    if len(points) == 1:
        return {"x": float(points[0]["x"]), "y": float(points[0]["y"])}

    remaining = max(0.0, float(progress_px))
    for idx in range(len(points) - 1):
        left = points[idx]
        right = points[idx + 1]
        seg_len = _point_distance(left, right)
        if seg_len <= 1e-9:
            continue
        if remaining <= seg_len:
            ratio = remaining / seg_len
            return {
                "x": float(left["x"] + (right["x"] - left["x"]) * ratio),
                "y": float(left["y"] + (right["y"] - left["y"]) * ratio),
            }
        remaining -= seg_len
    last = points[-1]
    return {"x": float(last["x"]), "y": float(last["y"])}


class WorldStateEngine(TimeSkipMixin):
    """World simulation engine with road-based NPC movement and social dynamics."""

    def __init__(self, core_api):
        self._core_api = core_api
        self._tick_count = 0
        self._world_seconds = 0.0
        self._map = None
        self._npcs = {}
        self._locations = {}
        self._pathfinder = None
        self._street_router = None
        self._config = copy.deepcopy(DEFAULT_CONFIG)
        self._tick_interval_ms = DEFAULT_CONFIG["tick_interval_ms"]
        self._simulation_speed = DEFAULT_SIMULATION_SPEED
        self._time_skip_mode = False
        self._lock = threading.RLock()
        self._task = None
        self._paused = False
        self._live_map_static_cache = None
        self._live_map_static_signature = None
        
        # New social dynamics engines
        self._relationship_engine = RelationshipEngine()
        self._memory_engine = MemoryEngine()
        self._mood_engine = MoodEngine()
        self._social_dynamics = SocialDynamicsEngine()

    def _load_config(self):
        raw = self._core_api.read_data("world_config.json", default_value={})
        merged = normalize_engine_config(raw, self._config)
        self._config = merged
        self._tick_interval_ms = merged["tick_interval_ms"]

    def get_config(self) -> dict:
        with self._lock:
            view = export_config_view(self._config)
            view["simulation_speed"] = self._simulation_speed
            return view

    def save_config(self, config: dict):
        with self._lock:
            self._config = normalize_engine_config(config, self._config)
            self._tick_interval_ms = self._config["tick_interval_ms"]
            payload = copy.deepcopy(self._config)
        self._core_api.save_data(payload, "world_config.json")

    def _normalize_loaded_npc(self, npc):
        npc.setdefault("home_location", npc.get("current_location"))
        npc.setdefault("activity", "idle")
        npc.setdefault("needs", {})
        npc.setdefault("preferences", {})
        npc.setdefault("relationships", {})
        npc.setdefault("last_location_interaction_tick", -10**9)
        npc.setdefault("last_road_interaction_tick", -10**9)

        npc.setdefault("money", 100.0)
        fin_plan = npc.setdefault("financial_plan", {})
        fin_plan.setdefault("target_balance", 200.0)
        fin_plan.setdefault("last_daily_balance", npc["money"])
        fin_plan.setdefault("prioritize_work", False)
        fin_plan.setdefault("extroverted_finance", False)

        movement = npc.get("movement")
        if not isinstance(movement, dict):
            movement = {}
            npc["movement"] = movement
        movement.setdefault("active", False)
        movement.setdefault("mode", "idle")
        movement.setdefault("origin_location", npc.get("current_location"))
        movement.setdefault("target_location", npc.get("current_location"))
        movement.setdefault("route_points", [])
        movement.setdefault("distance_px", 0.0)
        movement.setdefault("progress_px", 0.0)
        movement.setdefault("speed_px_per_sec", 0.0)
        movement.setdefault("activity_at_target", npc.get("activity", "idle"))
        if movement.get("render_position") is None and movement.get("route_points"):
            movement["render_position"] = _point_on_polyline(
                movement["route_points"],
                movement.get("progress_px", 0.0),
            )
        
        npc.setdefault("zodiac_index", 0)
        npc.setdefault("birthday", "1/1")
        npc.setdefault("social_pair", None)
        
        # Migrate to new schema if needed
        migrate_npc_to_new_schema(npc)

    def _ensure_world_extensions(self):
        if not isinstance(self._map, dict):
            return

        pending_births = self._map.setdefault("pending_births", [])
        if not isinstance(pending_births, list):
            self._map["pending_births"] = []
            pending_births = self._map["pending_births"]

        for event in pending_births:
            event.setdefault("id", len(pending_births))
            event.setdefault("parent_ids", [])
            event.setdefault("hospital_id", None)
            event.setdefault("due_world_sec", self._world_seconds + 3600.0)
            event.setdefault("completed", False)

        for loc in self._map.get("locations", []):
            if loc.get("type") != "construction_site":
                continue
            loc.setdefault("planned_type", "house")
            loc.setdefault("construction_required_hours", 24.0)
            loc.setdefault("construction_progress_hours", 0.0)
            loc.setdefault("construction_started_tick", self._tick_count)
            loc.setdefault("construction_status", "planned")
            loc.setdefault("builder_capacity", 4)

    def _ensure_builder_hq_present(self):
        if not isinstance(self._map, dict):
            return None
        if not self._locations:
            self._build_location_index(self._map)
        return self._place_builder_headquarters()

    def load_or_init(self):
        self._load_config()
        saved = self._core_api.read_data("world_state.json", default_value=None)
        if saved is not None and isinstance(saved, dict) and "map" in saved:
            with self._lock:
                self._tick_count = int(saved.get("tick_count", 0))
                legacy_minutes = self._tick_count * 30
                self._world_seconds = float(saved.get("world_seconds", legacy_minutes * 60))
                self._map = saved["map"]
                self._ensure_world_extensions()
                self._npcs = {int(key): value for key, value in saved.get("npcs", {}).items()}
                for npc in self._npcs.values():
                    self._normalize_loaded_npc(npc)
                self._build_location_index(self._map)
                self._ensure_builder_hq_present()
                for npc in self._npcs.values():
                    self._ensure_npc_job(npc)
                self._name_houses_after_occupants()
            print("[Plugin:World] World state loaded.")
            return

        generated_map = generate_world(self._config)
        with self._lock:
            self._map = generated_map
            self._ensure_world_extensions()
            self._tick_count = 0
            # Start at 6:00 AM - 8:00 AM
            self._world_seconds = float(random.randint(6, 7) * 3600 + random.randint(0, 59) * 60)
            self._build_location_index(self._map)
            self._ensure_builder_hq_present()
            self._init_npcs_from_spawns(self._map)
        print("[Plugin:World] New world generated.")

    def _auto_save(self):
        try:
            self._core_api.save_data(
                {
                    "tick_count": self._tick_count,
                    "world_seconds": self._world_seconds,
                    "map": self._map,
                    "npcs": self._npcs,
                },
                "world_state.json",
            )
        except Exception as exc:
            print(f"[Plugin:World] Auto-save failed: {exc}")

    def reset(self):
        with self._lock:
            self._paused = True
        self._load_config()
        generated_map = generate_world(self._config)
        with self._lock:
            self._map = generated_map
            self._ensure_world_extensions()
            self._tick_count = 0
            # Start at 6:00 AM - 8:00 AM
            self._world_seconds = float(random.randint(6, 7) * 3600 + random.randint(0, 59) * 60)
            self._build_location_index(self._map)
            self._ensure_builder_hq_present()
            self._init_npcs_from_spawns(self._map)
        self._core_api.save_data({}, "world_state.json")
        with self._lock:
            self._paused = False
        print("[Plugin:World] World reset.")

    def start(self):
        with self._lock:
            self._paused = False
        if self._task is None:
            self._task = self._core_api.register_background_task(
                plugin_id="world",
                task_name="tick_loop",
                target=self._tick_loop,
                pass_stop_event=True,
                auto_start=False,
            )
        self._task.start()

    def pause(self):
        with self._lock:
            self._paused = True

    def resume(self):
        with self._lock:
            self._paused = False

    def set_speed(self, speed_multiplier=None, tick_interval_ms=None):
        with self._lock:
            if speed_multiplier is not None:
                if speed_multiplier >= 1000:
                    self._simulation_speed = 1000
                    self._time_skip_mode = True
                else:
                    self._simulation_speed = max(1.0, min(100.0, float(speed_multiplier)))
                    self._time_skip_mode = False
            if tick_interval_ms is not None:
                self._tick_interval_ms = max(100, int(tick_interval_ms))
                self._config["tick_interval_ms"] = self._tick_interval_ms

    def get_state(self) -> dict:
        with self._lock:
            # Update house names before returning state
            self._name_houses_after_occupants()
            return copy.deepcopy(
                {
                    "tick_count": self._tick_count,
                    "world_time": calc_world_time(self._world_seconds),
                    "world_time_seconds": self._world_seconds,
                    "simulation_speed": self._simulation_speed,
                    "tick_interval_ms": self._tick_interval_ms,
                    "paused": self._paused,
                    "time_skip_mode": getattr(self, '_time_skip_mode', False),
                    "server_time_ms": int(time.time() * 1000),
                    "map": self._map,
                    "npcs": self._npcs,
                }
            )

    def _live_map_signature(self):
        if not isinstance(self._map, dict):
            return None
        locations = self._map.get("locations", [])
        return (
            self._map.get("seed"),
            self._map.get("mapSize"),
            len(self._map.get("streets", [])),
            len(self._map.get("cityBlocks", [])),
            tuple(
                (
                    loc.get("id"),
                    loc.get("x"),
                    loc.get("y"),
                    loc.get("bx"),
                    loc.get("by"),
                    loc.get("bw"),
                    loc.get("bh"),
                    loc.get("district"),
                    loc.get("rotation"),
                    loc.get("shape"),
                )
                for loc in locations
            ),
        )

    def _build_live_map_view(self) -> dict | None:
        if not isinstance(self._map, dict):
            return None

        signature = self._live_map_signature()
        if signature != self._live_map_static_signature or self._live_map_static_cache is None:
            static_map = {
                key: copy.deepcopy(value)
                for key, value in self._map.items()
                if key not in {"locations", "pending_births"}
            }
            static_locations = {}
            for loc in self._map.get("locations", []):
                static_locations[loc["id"]] = {
                    key: copy.deepcopy(value)
                    for key, value in loc.items()
                    if key not in {
                        "type",
                        "name",
                        "capacity",
                        "occupants",
                        "occupant_ids",
                        "planned_type",
                        "construction_required_hours",
                        "construction_progress_hours",
                        "construction_started_tick",
                        "construction_status",
                        "builder_capacity",
                    }
                }
            self._live_map_static_cache = {
                "map": static_map,
                "locations": static_locations,
            }
            self._live_map_static_signature = signature

        dynamic_locations = []
        static_locations = self._live_map_static_cache["locations"]
        for loc in self._map.get("locations", []):
            loc_view = dict(static_locations.get(loc["id"], {}))
            loc_view.update(
                {
                    "id": loc.get("id"),
                    "type": loc.get("type"),
                    "name": loc.get("name"),
                    "capacity": loc.get("capacity"),
                    "occupants": loc.get("occupants"),
                    "occupant_ids": list(loc.get("occupant_ids", [])),
                    "planned_type": loc.get("planned_type"),
                    "construction_required_hours": loc.get("construction_required_hours"),
                    "construction_progress_hours": loc.get("construction_progress_hours"),
                    "construction_started_tick": loc.get("construction_started_tick"),
                    "construction_status": loc.get("construction_status"),
                    "builder_capacity": loc.get("builder_capacity"),
                }
            )
            dynamic_locations.append(loc_view)

        live_map = dict(self._live_map_static_cache["map"])
        live_map["locations"] = dynamic_locations
        return live_map

    def get_live_state(self) -> dict:
        with self._lock:
            # Update house names before returning state
            self._name_houses_after_occupants()
            return {
                "tick_count": self._tick_count,
                "world_time": calc_world_time(self._world_seconds),
                "world_time_seconds": self._world_seconds,
                "simulation_speed": self._simulation_speed,
                "tick_interval_ms": self._tick_interval_ms,
                "paused": self._paused,
                "server_time_ms": int(time.time() * 1000),
                "map": self._build_live_map_view(),
                "npcs": copy.deepcopy(self._npcs),
            }

    def _tick_loop(self, stop_event):
        while not stop_event.is_set():
            with self._lock:
                paused = self._paused
                interval = self._tick_interval_ms
            if not paused:
                self._tick(interval / 1000.0)
            stop_event.wait(interval / 1000.0)

    def _advance_world_time(self, delta_seconds):
        self._world_seconds += delta_seconds * WORLD_SECONDS_PER_REAL_SECOND_AT_X1 * self._simulation_speed

    def _tick(self, delta_seconds=None):
        with self._lock:
            if not self._npcs or not self._map:
                return
            if delta_seconds is None:
                delta_seconds = self._tick_interval_ms / 1000.0
            
            # Handle time skip mode
            if self._time_skip_mode:
                self._perform_time_skip(delta_seconds)
                return
            
            world_hours_delta = (delta_seconds * WORLD_SECONDS_PER_REAL_SECOND_AT_X1 * self._simulation_speed) / 3600.0
            
            prev_day = int(self._world_seconds // 86400)
            self._advance_world_time(delta_seconds)
            current_day = int(self._world_seconds // 86400)
            current_hour = int(self._world_seconds % (24 * 3600)) // 3600

            if current_day > prev_day:
                for npc in self._npcs.values():
                    fin = npc.get("financial_plan", {})
                    if npc.get("money", 0.0) < fin.get("last_daily_balance", 0.0):
                        fin["prioritize_work"] = True
                    else:
                        fin["prioritize_work"] = False
                    fin["last_daily_balance"] = npc.get("money", 0.0)
                    self._review_npc_job(npc)

            # Update chaos factor
            self._social_dynamics.update_chaos_factor(self._tick_count)
            
            # Check for random shock events
            shocks = self._social_dynamics.check_random_shocks()
            for shock in shocks:
                print(f"[Plugin:World] Random shock: {shock['type']}")

            self._increase_needs(world_hours_delta)
            self._update_birth_events()
            self._maintain_construction_system()
            
            # Decay memories for all NPCs
            for npc in self._npcs.values():
                self._memory_engine.decay_memories(npc, world_hours_delta)
                
                # Decay mood
                self._mood_engine.decay_mood(npc)
                
                # Apply daily mood cycle
                self._mood_engine.apply_daily_mood_cycle(npc, current_hour)
                
                # Random minor mood shifts
                chaos_factor = self._social_dynamics.get_chaos_factor()
                self._mood_engine.apply_random_mood_shift(npc, chance=0.01 * chaos_factor)

            for npc in self._npcs.values():
                npc["_arrived_this_tick"] = False
                
                # Handle social pair active state
                if npc.get("social_pair"):
                    self._handle_npc_social_progression(npc, world_hours_delta)
                    continue
                    
                self._advance_npc_movement(npc, delta_seconds)

            for npc in self._npcs.values():
                if npc["movement"]["active"] or npc.get("social_pair"):
                    continue
                if npc.pop("_arrived_this_tick", False):
                    activity_name = npc.get("activity", "idle")
                    duration_h = ACTIVITY_DURATION_WORLD_HOURS.get(
                        activity_name, DEFAULT_ACTIVITY_DURATION_WORLD_HOURS
                    )
                    if activity_name == "birth_prep" and npc.get("birth_event_id"):
                        remaining_h = max(0.05, (npc.get("_stay_until_world_sec", self._world_seconds) - self._world_seconds) / 3600.0)
                        duration_h = remaining_h
                    elif activity_name == "sleep":
                        current_hour = int(self._world_seconds % (24 * 3600)) // 3600
                        if 6 <= current_hour < 22:
                            duration_h = 1.0
                    elif activity_name == "work":
                        loc = self._locations.get(npc["current_location"], {})
                        duration_h = WORK_DURATIONS.get(loc.get("type"), 4.0)
                    
                    if activity_name != "birth_prep":
                        duration_h *= random.uniform(0.8, 1.2)
                    npc["_stay_until_world_sec"] = self._world_seconds + duration_h * 3600.0
                    self._perform_activity(npc, activity_name, world_hours_delta)
                    continue

                # Stay at the location for the activity duration
                if self._world_seconds < npc.get("_stay_until_world_sec", 0):
                    self._perform_activity(npc, npc.get("activity", "idle"), world_hours_delta)
                    continue

                activity = self._choose_activity(npc)
                npc["activity"] = activity
                location_id = self._choose_location(npc, activity)
                if location_id is not None and location_id != npc["current_location"]:
                    self._begin_npc_movement(npc, location_id, activity)
                else:
                    duration_h = ACTIVITY_DURATION_WORLD_HOURS.get(
                        activity, DEFAULT_ACTIVITY_DURATION_WORLD_HOURS
                    )
                    if activity == "birth_prep" and npc.get("birth_event_id"):
                        duration_h = max(0.05, (npc.get("_stay_until_world_sec", self._world_seconds) - self._world_seconds) / 3600.0)
                    elif activity == "sleep":
                        current_hour = int(self._world_seconds % (24 * 3600)) // 3600
                        if 6 <= current_hour < 22:
                            duration_h = 1.0
                    elif activity == "work":
                        loc = self._locations.get(npc["current_location"], {})
                        duration_h = WORK_DURATIONS.get(loc.get("type"), 4.0)

                    if activity != "birth_prep":
                        duration_h *= random.uniform(0.8, 1.2)
                    npc["_stay_until_world_sec"] = self._world_seconds + duration_h * 3600.0
                    self._perform_activity(npc, activity, world_hours_delta)

            for npc in self._npcs.values():
                npc.pop("_arrived_this_tick", None)

            self._check_road_interactions()
            self._check_location_interactions()
            
            # Process social dynamics
            self._process_social_dynamics(world_hours_delta)
            
            # Check home leaving
            self._check_home_leaving(world_hours_delta)
            
            # Homeless NPCs with money try to buy a home
            for npc in self._npcs.values():
                if npc.get("home_location") is None and npc.get("money", 0.0) >= 150.0:
                    # 5% chance per world hour to house hunt
                    if random.random() < 0.05 * world_hours_delta:
                        self._try_buy_home(npc)
            
            self._tick_count += 1
            if self._tick_count % self._config.get("save_every_n_ticks", 10) == 0:
                self._auto_save()

    def _check_location_interactions(self):
        by_location = {}
        for npc in self._npcs.values():
            if npc["movement"]["active"] or npc.get("social_pair"):
                continue
            by_location.setdefault(npc["current_location"], []).append(npc)
                
        for loc_id, npcs_at_location in by_location.items():
            if len(npcs_at_location) < 2:
                continue
                
            loc_type = self._locations.get(loc_id, {}).get("type", "")
                
            for left_idx in range(len(npcs_at_location)):
                for right_idx in range(left_idx + 1, len(npcs_at_location)):
                    left = npcs_at_location[left_idx]
                    right = npcs_at_location[right_idx]
                    
                    if left.get("social_pair") or right.get("social_pair"):
                        continue
                        
                    if self._tick_count - left.get("last_location_interaction_tick", -10**9) < LOCATION_INTERACTION_COOLDOWN_TICKS:
                        continue
                    if self._tick_count - right.get("last_location_interaction_tick", -10**9) < LOCATION_INTERACTION_COOLDOWN_TICKS:
                        continue
                        
                    activity_left = left.get("activity", "idle")
                    activity_right = right.get("activity", "idle")
                    
                    category = None
                    if activity_left == "sleep" and activity_right == "sleep":
                        category = "sleep"
                    elif activity_left == "work" and activity_right == "work":
                        category = "work"
                    elif activity_left == "eat" and activity_right == "eat":
                        category = "eat"
                    elif loc_type == "shop" and activity_left in ("wander", "socialize") and activity_right in ("wander", "socialize"):
                        category = "shop"
                    elif activity_left == "socialize" and activity_right == "socialize":
                        category = "socialize"
                    elif loc_type in ACTIVITY_LOCATION_TYPES.get("socialize", set()):
                        category = "socialize"

                    if not category:
                        continue
                    
                    # Get relationship using new system
                    left_rel = self._relationship_engine.get_or_create_relationship(left, right["id"])
                    right_rel = self._relationship_engine.get_or_create_relationship(right, left["id"])
                    
                    # Check for enemies using trust dimension
                    left_trust = left_rel.get("trust", 0.0)
                    right_trust = right_rel.get("trust", 0.0)
                    min_trust = min(left_trust, right_trust)
                    
                    if min_trust <= -0.3:  # Enemies never pair
                        continue
                    
                    # Get relationship type for chance calculation
                    left_type = left_rel.get("type", "stranger")
                    right_type = right_rel.get("type", "stranger")
                    
                    # Calculate interaction chance based on relationship type
                    chance = 0.0
                    rel_type_priority = [left_type, right_type]
                    
                    if category == "sleep":
                        if "partner" in rel_type_priority: chance = 1.00
                        elif "dating" in rel_type_priority: chance = 0.90
                        elif "close_friend" in rel_type_priority: chance = 0.25
                    elif category == "work":
                        if "partner" in rel_type_priority: chance = 1.0
                        elif "dating" in rel_type_priority: chance = 0.95
                        elif "close_friend" in rel_type_priority: chance = 0.90
                        elif "friend" in rel_type_priority: chance = 0.40
                        elif "acquaintance" in rel_type_priority: chance = 0.05
                    elif category == "shop":
                        if "partner" in rel_type_priority: chance = 1.0
                        elif "dating" in rel_type_priority: chance = 0.95
                        elif "close_friend" in rel_type_priority: chance = 0.95
                        elif "friend" in rel_type_priority: chance = 0.60
                        elif "acquaintance" in rel_type_priority: chance = 0.05
                    elif category == "eat":
                        if "partner" in rel_type_priority: chance = 1.0
                        elif "dating" in rel_type_priority: chance = 0.95
                        elif "close_friend" in rel_type_priority: chance = 0.95
                        elif "friend" in rel_type_priority: chance = 0.70
                        elif "acquaintance" in rel_type_priority: chance = 0.20
                    elif category == "socialize":
                        chance = 1.0
                    
                    # Modify chance based on mood
                    left_social_eagerness = self._mood_engine.get_social_eagerness(left)
                    right_social_eagerness = self._mood_engine.get_social_eagerness(right)
                    avg_eagerness = (left_social_eagerness + right_social_eagerness) / 2
                    chance *= avg_eagerness

                    # Existing romantic commitments reduce casual pairings with low-affinity targets.
                    chance *= self._relationship_engine.get_social_pair_modifier(
                        left, right["id"], left_rel, category
                    )
                    chance *= self._relationship_engine.get_social_pair_modifier(
                        right, left["id"], right_rel, category
                    )
                    
                    # Modify by chaos factor
                    chaos_factor = self._social_dynamics.get_chaos_factor()
                    chance *= (0.5 + chaos_factor * 0.5)
                        
                    if random.random() > chance:
                        continue
                        
                    # Start social pair with a fixed outcome roll so previews stay truthful.
                    outcome_roll = random.random()
                    left["social_pair"] = self._make_social_pair_state(right["id"], outcome_roll, category)
                    right["social_pair"] = self._make_social_pair_state(left["id"], outcome_roll, category)
                    
                    if category == "socialize":
                        left["activity"] = "socializing"
                        right["activity"] = "socializing"
                    
                    self._trigger_npc_interaction(left, right, loc_id)
    def _trigger_npc_interaction(self, npc_a: dict, npc_b: dict, loc_id: int):
        loc = self._locations.get(loc_id, {})
        loc_type = loc.get("type", "unknown")

        def top_need(npc):
            needs = npc.get("needs", {})
            return max(needs, key=lambda key: needs[key]) if needs else "none"

        prompt = (
            f"{npc_a['name']} and {npc_b['name']} are at the same {loc_type}.\n"
            f"{npc_a['name']}: activity={npc_a.get('activity', 'idle')}, top_need={top_need(npc_a)}.\n"
            f"{npc_b['name']}: activity={npc_b.get('activity', 'idle')}, top_need={top_need(npc_b)}.\n"
            "Write a short natural conversation between them."
        )
        try:
            result = self._core_api.call_service(
                "chat:npc_interaction",
                system_prompt=prompt,
                npc_a=npc_a,
                npc_b=npc_b,
            )
            if result:
                print(f"[Plugin:World] NPC interaction: {npc_a['name']} <-> {npc_b['name']} @ {loc_type}")
        except Exception as exc:
            print(f"[Plugin:World] NPC interaction error: {exc}")

    def _check_road_interactions(self):
        walkers = []
        for npc in self._npcs.values():
            movement = npc.get("movement", {})
            if not movement.get("active") or movement.get("mode") != "walk" or npc.get("social_pair"):
                continue
            render_position = movement.get("render_position")
            if render_position is None:
                continue
            walkers.append(npc)

        for left_idx in range(len(walkers)):
            left = walkers[left_idx]
            for right_idx in range(left_idx + 1, len(walkers)):
                right = walkers[right_idx]
                
                if left.get("social_pair") or right.get("social_pair"):
                    continue
                    
                if self._tick_count - left.get("last_road_interaction_tick", -10**9) < ROAD_INTERACTION_COOLDOWN_TICKS:
                    continue
                if self._tick_count - right.get("last_road_interaction_tick", -10**9) < ROAD_INTERACTION_COOLDOWN_TICKS:
                    continue
                    
                left_pos = left["movement"]["render_position"]
                right_pos = right["movement"]["render_position"]
                if _point_distance(left_pos, right_pos) > ROAD_INTERACTION_DISTANCE_PX:
                    continue
                    
                # Need social logic
                left_top_need = max(left["needs"], key=lambda k: left["needs"][k]) if left["needs"] else "none"
                right_top_need = max(right["needs"], key=lambda k: right["needs"][k]) if right["needs"] else "none"
                
                if left_top_need != right_top_need:
                    continue
                    
                left_rel = self._relationship_engine.get_or_create_relationship(left, right["id"])
                right_rel = self._relationship_engine.get_or_create_relationship(right, left["id"])
                
                left_trust = left_rel.get("trust", 0.0)
                right_trust = right_rel.get("trust", 0.0)
                
                # Not enemies or hate
                if left_trust > -0.3 and right_trust > -0.3:
                    outcome_roll = random.random()
                    left["social_pair"] = self._make_social_pair_state(right["id"], outcome_roll)
                    right["social_pair"] = self._make_social_pair_state(left["id"], outcome_roll)
                    left["activity"] = "socializing"
                    right["activity"] = "socializing"
                    # Pause movement explicitly while social_pair is active so UI doesn't interpolate
                    left["movement"]["active"] = False
                    right["movement"]["active"] = False
                    # Pause movement implicitly while social_pair is active
                    self._trigger_npc_interaction(left, right, left["current_location"])

    def _increase_needs(self, world_hours_delta=1.0):
        # Determine the current world-hour (0-23) for time-based multipliers
        current_hour = int(self._world_seconds % (24 * 3600)) // 3600

        for npc in self._npcs.values():
            needs = npc["needs"]

            money = npc.get("money", 0.0)
            fin = npc.get("financial_plan", {})
            target = fin.get("target_balance", 200.0)
            deficit = max(0.0, target - money) / max(1.0, target)
            work_increase_base = deficit * 0.1
            if fin.get("prioritize_work"):
                work_increase_base *= 2.0
            
            work_multiplier = 1.0
            for start_h, end_h, mult in TIME_BASED_NEED_MULTIPLIER.get("work", []):
                if start_h <= current_hour < end_h:
                    work_multiplier = mult
                    break
                    
            needs.setdefault("work", 0.0)
            needs["work"] = max(0.0, min(1.0, needs["work"] + work_increase_base * work_multiplier * world_hours_delta))

            for need, base_rate in NEED_INCREASE_RATE.items():
                if need not in needs or need == "work":
                    continue
                # Look up time-of-day multiplier
                multiplier = 1.0
                for start_h, end_h, mult in TIME_BASED_NEED_MULTIPLIER.get(need, []):
                    if start_h <= current_hour < end_h:
                        multiplier = mult
                        break
                needs[need] = max(0.0, min(1.0, needs[need] + base_rate * multiplier * world_hours_delta))

    def _choose_activity(self, npc: dict) -> str:
        if npc.get("birth_event_id"):
            return "birth_prep"

        needs = npc["needs"]
        
        # If all needs are very low, choose based on personality (idle state replacement)
        if all(value < 0.2 for value in needs.values()):
            personality = npc.get("personality", {})
            extraversion = personality.get("extraversion", 0.5)
            conscientiousness = personality.get("conscientiousness", 0.5)
            openness = personality.get("openness", 0.5)
            agreeableness = personality.get("agreeableness", 0.5)
            
            choices = ["work", "socialize", "relax", "wander", "study"]
            weights = [
                0.1 + conscientiousness * 1.5,      # Work: higher for conscientious
                0.1 + extraversion * 1.0 + agreeableness * 0.5, # Social: extraverts/agreeable
                0.5 + (1.0 - conscientiousness) * 0.5, # Relax: lower for conscientious
                0.2 + openness * 1.0,               # Wander: higher for open
                0.1 + openness * 0.8 + conscientiousness * 0.6, # Study: open/conscientious
            ]
            
            # Time-of-day bias for idle activities
            current_hour = int(self._world_seconds % (24 * 3600)) // 3600
            if current_hour < 7 or current_hour > 21:
                weights[0] = 0.0   # No work at late night/early morning
                weights[1] *= 0.1  # Minimal social
                weights[3] *= 0.1  # Minimal wandering
                weights[4] *= 0.2  # Very little study late at night
            
            if sum(weights) <= 0:
                return "idle"
                
            return random.choices(choices, weights=weights)[0]

        # Standard behavior: pick the activity that addresses the highest need
        return NEED_TO_ACTIVITY.get(max(needs, key=lambda key: needs[key]), "idle")

    def _route_distance(self, from_location_id, to_location_id):
        if from_location_id == to_location_id:
            return 0.0
        if self._street_router is not None:
            route = self._street_router.route_between_locations(from_location_id, to_location_id)
            if route is not None:
                return route["distance_px"]
        path = self._pathfinder.find_path(from_location_id, to_location_id) if self._pathfinder else None
        if path is None:
            return None
        return float(max(0, len(path) - 1) * 100)

    def _locations_of_type(self, location_type: str) -> list[dict]:
        return [loc for loc in self._locations.values() if loc.get("type") == location_type]

    def _nearest_location_of_type(self, from_location_id, location_type: str) -> Optional[int]:
        candidates = self._locations_of_type(location_type)
        if not candidates:
            return None
        best_loc_id = None
        best_distance = None
        for loc in candidates:
            dist = self._route_distance(from_location_id, loc["id"])
            if dist is None:
                dist = float("inf")
            if best_distance is None or dist < best_distance:
                best_distance = dist
                best_loc_id = loc["id"]
        return best_loc_id

    def _pending_births(self) -> list[dict]:
        self._ensure_world_extensions()
        return self._map.setdefault("pending_births", [])

    def _family_links(self, npc: dict) -> dict:
        family_links = npc.setdefault("family_links", {})
        for key in ("parents", "children", "siblings"):
            links = family_links.get(key)
            if not isinstance(links, list):
                family_links[key] = []
        return family_links

    def _append_unique_family_link(self, npc: dict, link_type: str, other_id: int):
        if other_id == npc.get("id"):
            return
        family_links = self._family_links(npc)
        links = family_links.setdefault(link_type, [])
        if other_id not in links:
            links.append(other_id)

    def _link_family_on_birth(self, newborn: dict, parent_ids: list[int]):
        valid_parent_ids = [parent_id for parent_id in parent_ids if parent_id in self._npcs]
        sibling_ids = set()

        for parent_id in valid_parent_ids:
            parent = self._npcs[parent_id]
            self._append_unique_family_link(newborn, "parents", parent_id)
            self._append_unique_family_link(parent, "children", newborn["id"])
            for child_id in self._family_links(parent).get("children", []):
                if child_id != newborn["id"] and child_id in self._npcs:
                    sibling_ids.add(child_id)

        for sibling_id in sibling_ids:
            sibling = self._npcs.get(sibling_id)
            if not sibling:
                continue
            self._append_unique_family_link(newborn, "siblings", sibling_id)
            self._append_unique_family_link(sibling, "siblings", newborn["id"])

    def _has_pending_birth_for_pair(self, npc_a_id: int, npc_b_id: int) -> bool:
        pair_ids = {npc_a_id, npc_b_id}
        for event in self._pending_births():
            if event.get("completed"):
                continue
            if set(event.get("parent_ids", [])) == pair_ids:
                return True
        return False

    def _choose_birth_hospital(self, npc_a: dict, npc_b: dict) -> Optional[int]:
        hospitals = self._locations_of_type("hospital")
        if not hospitals:
            return None
        score_from_a = {
            loc["id"]: (self._route_distance(npc_a.get("current_location"), loc["id"]) or 0.0)
            for loc in hospitals
        }
        best_loc = min(
            hospitals,
            key=lambda loc: score_from_a.get(loc["id"], 0.0)
            + (self._route_distance(npc_b.get("current_location"), loc["id"]) or 0.0),
        )
        return best_loc["id"]

    def _schedule_birth_event(self, npc_a: dict, npc_b: dict) -> bool:
        if self._has_pending_birth_for_pair(npc_a["id"], npc_b["id"]):
            return False

        hospital_id = self._choose_birth_hospital(npc_a, npc_b)
        if hospital_id is None:
            return False

        pending_births = self._pending_births()
        event_id = max([event.get("id", 0) for event in pending_births] + [0]) + 1
        due_world_sec = self._world_seconds + 3600.0
        event = {
            "id": event_id,
            "parent_ids": [npc_a["id"], npc_b["id"]],
            "hospital_id": hospital_id,
            "due_world_sec": due_world_sec,
            "completed": False,
        }
        pending_births.append(event)

        for parent in (npc_a, npc_b):
            parent["birth_event_id"] = event_id
            parent["activity"] = "birth_prep"
            parent["_stay_until_world_sec"] = due_world_sec
            if parent.get("current_location") != hospital_id:
                self._begin_npc_movement(parent, hospital_id, "birth_prep")

        return True

    def _maybe_schedule_birth_from_sleep_pair(self, npc: dict, partner: dict, pair: dict, success: bool):
        if not success:
            return
        if pair.get("category") != "sleep":
            return
        if npc["id"] > partner["id"]:
            return

        rel_a = self._relationship_engine.get_or_create_relationship(npc, partner["id"])
        rel_b = self._relationship_engine.get_or_create_relationship(partner, npc["id"])
        rel_types = {rel_a.get("type", "stranger"), rel_b.get("type", "stranger")}
        if "partner" not in rel_types and "dating" not in rel_types:
            return

        if npc.get("birth_event_id") or partner.get("birth_event_id"):
            return
        if self._has_pending_birth_for_pair(npc["id"], partner["id"]):
            return

        chance = max(0.0, min(1.0, float(self._config.get("birthRate", 100) or 0) / 100.0))
        if random.random() < chance:
            self._schedule_birth_event(npc, partner)

    def _spawn_newborn_from_event(self, event: dict):
        hospital_id = event.get("hospital_id")
        if hospital_id is None or hospital_id not in self._locations:
            event["completed"] = True
            return

        parent_ids = [pid for pid in event.get("parent_ids", []) if pid in self._npcs]
        parent_home = None
        for parent_id in parent_ids:
            home_location = self._npcs[parent_id].get("home_location")
            if home_location in self._locations:
                parent_home = home_location
                break

        next_npc_id = max(self._npcs.keys(), default=-1) + 1
        rng_seed = int(self._map.get("seed", self._config.get("seed") or 0)) + next_npc_id + self._tick_count
        rng = random.Random(rng_seed)
        used_hashes = {
            other.get("character_hash")
            for other in self._npcs.values()
            if other.get("character_hash")
        }
        newborn = build_single_npc(
            next_npc_id,
            hospital_id,
            rng,
            core_api=self._core_api,
            personality_profile=self._config.get("personalityProfile"),
            used_character_hashes=used_hashes,
        )
        newborn["home_location"] = parent_home
        newborn["current_location"] = hospital_id
        newborn["moved_in_tick"] = self._tick_count
        newborn["activity"] = "birth_prep"
        newborn["_stay_until_world_sec"] = self._world_seconds + 0.25 * 3600.0
        self._normalize_loaded_npc(newborn)
        self._npcs[next_npc_id] = newborn
        self._link_family_on_birth(newborn, parent_ids)
        self._ensure_npc_job(newborn)
        self._add_npc_to_location(newborn, hospital_id)

        for parent_id in parent_ids:
            parent = self._npcs[parent_id]
            parent["birth_event_id"] = None
            parent["activity"] = "birth_prep"
            parent["_stay_until_world_sec"] = self._world_seconds + 0.25 * 3600.0

        event["completed"] = True
        self._name_houses_after_occupants()

    def _update_birth_events(self):
        pending_births = self._pending_births()
        for event in pending_births:
            if event.get("completed"):
                continue
            if self._world_seconds >= float(event.get("due_world_sec", self._world_seconds + 1)):
                self._spawn_newborn_from_event(event)

        self._map["pending_births"] = [event for event in pending_births if not event.get("completed")]

    def _target_building_counts(self) -> dict:
        planner_config = dict(self._config)
        planner_config["npcCount"] = max(1, len(self._npcs))
        planner = WorldGenerator(planner_config)
        planner._calculate_house_count()
        planner._calculate_functional_building_counts()
        return dict(planner.building_counts)

    def _current_building_counts_for_planning(self) -> dict:
        counts = {}
        for loc in self._locations.values():
            loc_type = loc.get("type")
            if loc_type == "construction_site":
                planned_type = loc.get("planned_type")
                if planned_type:
                    counts[planned_type] = counts.get(planned_type, 0) + 1
            elif loc_type != "builder_hq":
                counts[loc_type] = counts.get(loc_type, 0) + 1
        return counts

    def _determine_needed_building_types(self) -> list[str]:
        target_counts = self._target_building_counts()
        current_counts = self._current_building_counts_for_planning()
        house_capacity = sum(
            loc.get("capacity", 0)
            for loc in self._locations.values()
            if loc.get("type") == "house"
        )
        needed_types = []

        target_house_count = int(target_counts.get("house", 0) or 0)
        current_house_count = int(current_counts.get("house", 0) or 0)
        house_count_deficit = max(0, target_house_count - current_house_count)
        house_capacity_deficit = max(0, len(self._npcs) - house_capacity)
        extra_houses_for_capacity = (house_capacity_deficit + 2) // 3 if house_capacity_deficit > 0 else 0
        house_deficit = max(house_count_deficit, extra_houses_for_capacity)
        needed_types.extend(["house"] * house_deficit)

        functional_deficits = []
        for building_type, target in target_counts.items():
            if building_type == "house":
                continue
            deficit = max(0, int(target) - int(current_counts.get(building_type, 0) or 0))
            if deficit > 0:
                functional_deficits.append((deficit, building_type))

        functional_deficits.sort(key=lambda item: (-item[0], item[1]))
        for deficit, building_type in functional_deficits:
            needed_types.extend([building_type] * deficit)

        return needed_types

    def _max_concurrent_construction_sites(self) -> int:
        population = max(1, len(self._npcs))
        return max(1, min(6, population // 18 + 1))

    def _builder_headquarters(self) -> Optional[dict]:
        for loc in self._locations.values():
            if loc.get("type") == "builder_hq":
                return loc
        return None

    def _active_construction_sites(self) -> list[dict]:
        return [loc for loc in self._locations.values() if loc.get("type") == "construction_site"]

    def _work_location_types(self) -> set[str]:
        return {loc_type for loc_type in WORK_WAGES.keys() if loc_type != "construction_site"}

    def _make_dynamic_location_planner(self) -> WorldGenerator:
        planner_config = dict(self._config)
        planner_config["npcCount"] = max(1, len(self._npcs))
        planner = WorldGenerator(planner_config)
        planner.map_size = int(self._map.get("mapSize", 600))
        planner.streets = copy.deepcopy(self._map.get("streets", []))
        planner.locations = list(self._map.get("locations", []))
        planner._next_location_id = max([loc.get("id", -1) for loc in planner.locations] + [-1]) + 1
        planner._occupied_grid = set()
        for loc in planner.locations:
            planner._occupy_grid(loc["bx"], loc["by"], loc["bw"], loc["bh"])
        return planner

    def _place_dynamic_location(
        self,
        building_type: str,
        size: tuple[int, int],
        footprint: tuple[int, int],
        capacity: int,
        extra_fields: Optional[dict] = None,
    ) -> Optional[dict]:
        planner = self._make_dynamic_location_planner()
        roads = [street for street in planner.streets if street["tier"] in {"arterial", "local"}]
        if not roads:
            return None

        gap = planner._house_gap() if building_type == "house" else 8
        prefer_edge = building_type == "house"
        prefer_intersection = building_type != "house"
        pos = planner._find_position_near_road(
            roads,
            size,
            prefer_edge=prefer_edge,
            prefer_intersection=prefer_intersection,
            gap=gap,
        )
        if pos is None:
            return None

        location = {
            "id": planner._next_location_id,
            "type": building_type,
            "x": pos["x"],
            "y": pos["y"],
            "bx": pos["bx"],
            "by": pos["by"],
            "bw": size[0],
            "bh": size[1],
            "rotation": 0,
            "district": 0,
            "capacity": capacity,
            "occupants": 0,
            "occupant_ids": [],
            "environment": planner._random_environment(),
            "footprint": {"w": footprint[0], "h": footprint[1]},
        }
        if extra_fields:
            location.update(extra_fields)

        planner._occupy_grid(location["bx"], location["by"], location["bw"], location["bh"])
        planner._connect_single_building(location)
        self._map.setdefault("locations", []).append(location)
        self._build_location_index(self._map)
        return self._locations.get(location["id"], location)

    def _place_builder_headquarters(self) -> Optional[dict]:
        existing = self._builder_headquarters()
        if existing is not None:
            return existing
        size = BUILDING_SIZES["builder_hq"]
        footprint = BUILDING_FOOTPRINTS["builder_hq"]
        return self._place_dynamic_location(
            "builder_hq",
            size,
            footprint,
            FIXED_CAPACITY["builder_hq"],
            extra_fields={"name": "Trạm xây dựng"},
        )

    def _place_construction_site(self, planned_type: str) -> Optional[dict]:
        if planned_type not in BUILDING_SIZES:
            return None

        size = BUILDING_SIZES[planned_type]
        footprint = BUILDING_FOOTPRINTS[planned_type]
        required_hours = 24.0 if planned_type == "house" else 48.0
        builder_capacity = 3 if planned_type == "house" else 5
        label_map = {
            "house": "Nhà",
            "shop": "Cửa hàng",
            "office": "Văn phòng",
            "factory": "Nhà máy",
            "studio": "Studio",
            "school": "Trường học",
            "hospital": "Bệnh viện",
            "library": "Thư viện",
            "gym": "Phòng gym",
            "arcade": "Khu trò chơi",
            "museum": "Bảo tàng",
            "cinema": "Rạp phim",
            "cafe": "Cafe",
        }
        return self._place_dynamic_location(
            "construction_site",
            size,
            footprint,
            max(8, builder_capacity + 2),
            extra_fields={
                "planned_type": planned_type,
                "construction_required_hours": required_hours,
                "construction_progress_hours": 0.0,
                "construction_started_tick": self._tick_count,
                "construction_status": "planned",
                "builder_capacity": builder_capacity,
                "name": f"Công trường {label_map.get(planned_type, planned_type.capitalize())}",
            },
        )

    def _assigned_builder_count(self, builder_hq_id: int) -> int:
        return self._assigned_worker_count(builder_hq_id)

    def _desired_builder_count(self) -> int:
        desired = 0
        for site in self._active_construction_sites():
            builder_capacity = max(1, int(site.get("builder_capacity", 1) or 1))
            if site.get("planned_type") == "house":
                desired += max(2, builder_capacity)
            else:
                desired += max(3, builder_capacity)
        return desired

    def _rebalance_builder_jobs(self):
        builder_hq = self._builder_headquarters()
        if builder_hq is None:
            return

        desired = min(self._job_capacity(builder_hq), max(0, self._desired_builder_count()))
        current = self._assigned_builder_count(builder_hq["id"])
        if current >= desired:
            return

        candidates = [
            npc for npc in self._npcs.values()
            if npc.get("job_location") != builder_hq["id"]
            and not npc["movement"].get("active")
            and not npc.get("social_pair")
        ]
        candidates.sort(
            key=lambda npc: (
                npc.get("needs", {}).get("work", 0.0),
                npc.get("personality", {}).get("conscientiousness", 0.5)
                + npc.get("personality", {}).get("agreeableness", 0.5),
                -npc.get("money", 0.0),
            ),
            reverse=True,
        )
        for npc in candidates[: max(0, desired - current)]:
            npc["job_location"] = builder_hq["id"]
            npc["job_type"] = "builder_hq"
            npc["job_assigned_tick"] = self._tick_count
            npc["job_change_reason"] = "construction_demand"
            npc["job_change_cooldown_tick"] = self._tick_count + 360

    def _pick_construction_site_for_builder(self, npc: dict) -> Optional[int]:
        sites = self._active_construction_sites()
        if not sites:
            npc["assigned_construction_site"] = None
            return None

        current_assignment = npc.get("assigned_construction_site")
        if current_assignment in self._locations:
            site = self._locations[current_assignment]
            if site.get("type") == "construction_site" and site.get("construction_progress_hours", 0.0) < site.get("construction_required_hours", 1.0):
                return current_assignment

        best_site = min(
            sites,
            key=lambda loc: (
                self._assigned_worker_count(loc["id"], exclude_npc_id=npc["id"]),
                self._route_distance(npc.get("current_location"), loc["id"]) or 0.0,
            ),
        )
        npc["assigned_construction_site"] = best_site["id"]
        return best_site["id"]

    def _complete_construction_site(self, site_id: int):
        site = self._locations.get(site_id)
        if not site or site.get("type") != "construction_site":
            return

        planned_type = site.get("planned_type", "house")
        site["type"] = planned_type
        if planned_type == "house":
            site["capacity"] = 3
        else:
            site["capacity"] = FIXED_CAPACITY.get(planned_type, site.get("capacity", 6))
        site.pop("planned_type", None)
        site.pop("construction_required_hours", None)
        site.pop("construction_progress_hours", None)
        site.pop("construction_started_tick", None)
        site.pop("construction_status", None)
        site.pop("builder_capacity", None)
        site["name"] = None

        for npc in self._npcs.values():
            if npc.get("assigned_construction_site") == site_id:
                npc["assigned_construction_site"] = None

        self._name_houses_after_occupants()

    def _maintain_construction_system(self):
        needed_building_types = self._determine_needed_building_types()
        active_sites = self._active_construction_sites()

        if needed_building_types:
            self._place_builder_headquarters()
            available_site_slots = max(0, self._max_concurrent_construction_sites() - len(active_sites))
            for planned_type in needed_building_types[:available_site_slots]:
                placed = self._place_construction_site(planned_type)
                if placed is None:
                    break
            active_sites = self._active_construction_sites()

        if active_sites:
            self._place_builder_headquarters()
            self._rebalance_builder_jobs()

    def _is_valid_work_location(self, location_id) -> bool:
        loc = self._locations.get(location_id)
        return bool(loc and loc.get("type") in self._work_location_types())

    def _job_capacity(self, loc: dict) -> int:
        loc_type = loc.get("type")
        venue_capacity = max(1, int(loc.get("capacity", 1) or 1))
        configured = JOB_CAPACITY_BY_TYPE.get(loc_type)
        if configured is None:
            configured = max(2, int(round(venue_capacity * 0.45)))
        return max(1, min(venue_capacity, int(configured)))

    def _job_overflow_capacity(self, loc: dict) -> int:
        nominal_capacity = self._job_capacity(loc)
        venue_capacity = max(1, int(loc.get("capacity", nominal_capacity) or nominal_capacity))
        overflow_extra = max(1, int(round(nominal_capacity * 0.35)))
        return max(nominal_capacity, min(venue_capacity, nominal_capacity + overflow_extra))

    def _assigned_worker_count(self, location_id: int, exclude_npc_id: Optional[int] = None) -> int:
        count = 0
        for other in self._npcs.values():
            if exclude_npc_id is not None and other["id"] == exclude_npc_id:
                continue
            if other.get("job_location") == location_id:
                count += 1
        return count

    def _employed_worker_count(self, exclude_npc_id: Optional[int] = None) -> int:
        count = 0
        for other in self._npcs.values():
            if exclude_npc_id is not None and other["id"] == exclude_npc_id:
                continue
            if self._is_valid_work_location(other.get("job_location")):
                count += 1
        return count

    def _total_job_capacity(self) -> int:
        total_capacity = 0
        for loc in self._locations.values():
            if loc.get("type") in self._work_location_types():
                total_capacity += self._job_capacity(loc)
        return total_capacity

    def _workplace_social_pressure(self, npc: dict, location_id: int) -> dict:
        hostility = 0.0
        warmth = 0.0
        enemy_count = 0
        rival_count = 0
        friend_count = 0

        for other in self._npcs.values():
            if other["id"] == npc["id"]:
                continue
            if other.get("job_location") != location_id:
                continue
            rel = npc.get("relationships", {}).get(str(other["id"]), {})
            if isinstance(rel, dict):
                rel_type = rel.get("type", "stranger")
                trust = rel.get("trust", 0.0)
            else:
                rel_type = "stranger"
                trust = float(rel) if rel else 0.3

            if rel_type == "enemy" or trust <= -0.35:
                enemy_count += 1
                hostility += 2.5
            elif rel_type == "rival" or trust <= -0.15:
                rival_count += 1
                hostility += 1.1
            elif rel_type in ("partner", "dating", "close_friend"):
                friend_count += 1
                warmth += 1.4
            elif rel_type == "friend" or trust >= 0.35:
                friend_count += 1
                warmth += 0.7

        return {
            "hostility": hostility,
            "warmth": warmth,
            "enemy_count": enemy_count,
            "rival_count": rival_count,
            "friend_count": friend_count,
        }

    def _score_workplace(self, npc: dict, loc_id: int, prefer_current_job: bool = False) -> float:
        loc = self._locations.get(loc_id)
        if not loc or loc.get("type") not in self._work_location_types():
            return float("-inf")

        personality = npc.get("personality", {})
        current_loc_id = npc.get("current_location")
        home_loc_id = npc.get("home_location")
        route_from_home = self._route_distance(home_loc_id, loc_id) if home_loc_id is not None else None
        route_from_current = self._route_distance(current_loc_id, loc_id) if current_loc_id is not None else None
        chosen_distance = route_from_home if route_from_home is not None else route_from_current
        map_size = (self._map or {}).get("mapSize", 600)
        max_route_distance = max(200.0, float(map_size) * 2.5)
        distance_penalty = 0.0 if chosen_distance is None else min(1.0, chosen_distance / max_route_distance) * 1.2

        wage = WORK_WAGES.get(loc.get("type"), 0.0)
        max_wage = max(WORK_WAGES.values()) if WORK_WAGES else 1.0
        wage_score = wage / max_wage

        extroversion = personality.get("extraversion", 0.5)
        openness = personality.get("openness", 0.5)
        conscientiousness = personality.get("conscientiousness", 0.5)

        type_fit = {
            "cafe": extroversion * 0.8 + personality.get("agreeableness", 0.5) * 0.2,
            "office": conscientiousness * 0.8 + (1.0 - extroversion) * 0.2,
            "factory": conscientiousness * 0.7 + (1.0 - openness) * 0.3,
            "studio": openness * 0.7 + extroversion * 0.2,
            "builder_hq": conscientiousness * 0.9 + personality.get("agreeableness", 0.5) * 0.35 + extroversion * 0.1,
            "shop": extroversion * 0.7 + conscientiousness * 0.2,
            "school": conscientiousness * 0.6 + personality.get("agreeableness", 0.5) * 0.3,
            "hospital": conscientiousness * 0.6 + personality.get("agreeableness", 0.5) * 0.4,
            "library": openness * 0.5 + conscientiousness * 0.5,
            "gym": extroversion * 0.45 + conscientiousness * 0.35,
            "arcade": extroversion * 0.6 + openness * 0.3,
            "museum": openness * 0.7 + conscientiousness * 0.2,
            "cinema": extroversion * 0.45 + openness * 0.35,
        }.get(loc.get("type"), 0.5)

        social = self._workplace_social_pressure(npc, loc_id)
        assigned_workers = self._assigned_worker_count(loc_id, exclude_npc_id=npc["id"])
        nominal_capacity = self._job_capacity(loc)
        overflow_capacity = self._job_overflow_capacity(loc)
        total_nominal_capacity = max(1, self._total_job_capacity())
        employed_workers = self._employed_worker_count(exclude_npc_id=npc["id"])
        overflow_needed = employed_workers + 1 > total_nominal_capacity
        is_current_job = npc.get("job_location") == loc_id
        active_construction_bonus = 0.0
        if loc.get("type") == "builder_hq":
            active_site_count = len(self._active_construction_sites())
            active_construction_bonus = min(1.8, active_site_count * 0.55)

        if assigned_workers >= overflow_capacity and not is_current_job:
            return float("-inf")
        if assigned_workers >= nominal_capacity and not overflow_needed and not is_current_job:
            return float("-inf")

        crowd_penalty = 0.0
        if assigned_workers >= nominal_capacity:
            overflow_load = assigned_workers - nominal_capacity + 1
            crowd_penalty += overflow_load * (0.85 if overflow_needed else 2.4)
        crowd_penalty += max(0.0, (assigned_workers - overflow_capacity + 1) * 1.2)
        stability_bonus = 0.75 if prefer_current_job and npc.get("job_location") == loc_id else 0.0

        return (
            wage_score * 2.2
            + type_fit * 1.2
            + social["warmth"] * 0.55
            - social["hostility"] * 1.8
            - distance_penalty
            - crowd_penalty
            + active_construction_bonus
            + stability_bonus
            + random.uniform(-0.03, 0.03)
        )

    def _pick_best_job_location(self, npc: dict, prefer_current_job: bool = False) -> Optional[int]:
        best_loc_id = None
        best_score = float("-inf")
        for loc_id in self._locations.keys():
            score = self._score_workplace(npc, loc_id, prefer_current_job=prefer_current_job)
            if score > best_score:
                best_score = score
                best_loc_id = loc_id
        return best_loc_id

    def _assign_job(self, npc: dict, reason: str = "initial_assignment", force: bool = False) -> Optional[int]:
        current_job = npc.get("job_location")
        if not force and current_job is not None and self._is_valid_work_location(current_job):
            return current_job

        new_job = self._pick_best_job_location(npc, prefer_current_job=False)
        if new_job is None:
            npc["job_location"] = None
            npc["job_type"] = None
            return None

        npc["job_location"] = new_job
        npc["job_type"] = self._locations[new_job].get("type")
        npc["job_assigned_tick"] = self._tick_count
        npc["job_change_reason"] = reason
        npc["job_change_cooldown_tick"] = self._tick_count + 240
        return new_job

    def _ensure_npc_job(self, npc: dict) -> Optional[int]:
        job_location = npc.get("job_location")
        if self._is_valid_work_location(job_location):
            loc = self._locations[job_location]
            npc["job_type"] = loc.get("type")
            return job_location
        return self._assign_job(npc, reason="initial_assignment", force=True)

    def _job_change_pressure(self, npc: dict) -> Tuple[float, Optional[str]]:
        job_location = npc.get("job_location")
        if not self._is_valid_work_location(job_location):
            return 1.0, "job_missing"

        social = self._workplace_social_pressure(npc, job_location)
        if social["enemy_count"] > 0:
            chance = 0.015 + social["enemy_count"] * 0.01 + social["rival_count"] * 0.004
            return min(0.08, chance), "hostile_coworker"
        if social["rival_count"] > 1:
            return 0.012, "rival_coworker"

        if npc.get("job_type") == "builder_hq" and self._active_construction_sites():
            return 0.0002, "construction_demand_hold"

        target_balance = npc.get("financial_plan", {}).get("target_balance", 200.0)
        wage_here = WORK_WAGES.get(npc.get("job_type"), 0.0)
        if target_balance > 0 and npc.get("money", 0.0) < target_balance * 0.2:
            if wage_here < max(WORK_WAGES.values()) * 0.55:
                return 0.01, "better_pay"

        return 0.0015, "career_drift"

    def _review_npc_job(self, npc: dict):
        job_location = self._ensure_npc_job(npc)
        if job_location is None:
            return
        if self._tick_count < int(npc.get("job_change_cooldown_tick", 0) or 0):
            return

        chance, reason = self._job_change_pressure(npc)
        if reason is None or random.random() >= chance:
            return

        old_job = npc.get("job_location")
        old_score = self._score_workplace(npc, old_job, prefer_current_job=True) if old_job is not None else float("-inf")
        new_job = self._pick_best_job_location(npc, prefer_current_job=False)
        if new_job is None or new_job == old_job:
            npc["job_change_cooldown_tick"] = self._tick_count + 120
            return

        new_score = self._score_workplace(npc, new_job, prefer_current_job=False)
        minimum_gain = 0.2 if reason == "better_pay" else 0.35
        if reason in ("hostile_coworker", "job_missing"):
            minimum_gain = -0.2
        if new_score < old_score + minimum_gain:
            npc["job_change_cooldown_tick"] = self._tick_count + 120
            return

        self._assign_job(npc, reason=reason, force=True)

    def _score_locations(self, npc: dict, activity: str) -> list:
        current_loc_id = npc["current_location"]
        home_loc_id = npc.get("home_location")
        preferences = npc.get("preferences", {})
        relationships = npc.get("relationships", {})
        valid_types = ACTIVITY_LOCATION_TYPES.get(activity)
        map_size = (self._map or {}).get("mapSize", 600)
        max_route_distance = max(200.0, float(map_size) * 2.5)
        scored = []
        for loc_id, loc in self._locations.items():
            occupants = loc.get("occupants", 0)
            capacity = loc.get("capacity", 1)
            # Don't count the NPC itself when evaluating its current location
            if loc_id == current_loc_id:
                occupants = max(0, occupants - 1)
            if occupants >= capacity:
                continue
            if valid_types is not None and loc.get("type") not in valid_types:
                continue
            activity_match = 1.0 if valid_types is None else (1.0 if loc.get("type") in valid_types else 0.0)
            
            loc_type = loc.get("type")
            extroverted = npc.get("financial_plan", {}).get("extroverted_finance", False)
            if activity == "eat":
                price = FOOD_PRICES.get(loc_type, 0.0)
                if price > 0 and npc.get("money", 0.0) < price:
                    continue # prohibit eating out if broke
                if loc_type in ("cafe", "shop"):
                    activity_match += 1.0 if extroverted else -0.5
                elif loc_type == "cinema":
                    activity_match += 0.7 if extroverted else 0.1
                elif loc_id == home_loc_id:
                    if not extroverted:
                        activity_match += 1.5
            elif activity == "work":
                if npc.get("job_location") == loc_id:
                    activity_match += 5.0
                dur = WORK_DURATIONS.get(loc_type, 4.0)
                if not extroverted:
                    activity_match += dur * 0.15
                else:
                    activity_match += (8.0 - dur) * 0.15
            elif activity == "study":
                openness = npc.get("personality", {}).get("openness", 0.5)
                conscientiousness = npc.get("personality", {}).get("conscientiousness", 0.5)
                if loc_type == "school":
                    activity_match += 1.0 + conscientiousness * 0.6
                elif loc_type == "library":
                    activity_match += 1.1 + openness * 0.5 + (1.0 - extroverted) * 0.3
                elif loc_type == "museum":
                    activity_match += 0.9 + openness * 0.7
            elif activity == "relax":
                openness = npc.get("personality", {}).get("openness", 0.5)
                if loc_type == "park":
                    activity_match += 0.8 + preferences.get("nature", 0.0) * 0.8
                elif loc_type == "shrine":
                    activity_match += 0.8 + (1.0 - extroverted) * 0.4
                elif loc_type == "library":
                    activity_match += 0.7 + (1.0 - extroverted) * 0.5
                elif loc_type == "gym":
                    activity_match += 0.9 + extroverted * 0.5
                elif loc_type == "arcade":
                    activity_match += 1.0 + extroverted * 0.5
                elif loc_type == "cinema":
                    activity_match += 0.9 + openness * 0.3 + extroverted * 0.3
                elif loc_type == "museum":
                    activity_match += 0.8 + openness * 0.6
            elif activity == "socialize":
                if loc_type in ("cafe", "shop"):
                    activity_match += 0.7 + extroverted * 0.6
                elif loc_type == "gym":
                    activity_match += 0.6 + extroverted * 0.6
                elif loc_type == "arcade":
                    activity_match += 1.0 + extroverted * 0.6
                elif loc_type == "cinema":
                    activity_match += 0.7 + extroverted * 0.4

            env = loc.get("environment", {})
            preference_match = sum(preferences.get(key, 0.0) * env.get(key, 0.0) for key in ("quiet", "crowded"))
            
            relationship_bonus = 0.0
            has_enemy = False
            for oid in loc.get("occupant_ids", []):
                rel_data = relationships.get(str(oid), {})
                # Handle both old (float) and new (dict) relationship formats
                if isinstance(rel_data, dict):
                    rel_trust = rel_data.get("trust", 0.0)
                    rel_type = rel_data.get("type", "stranger")
                else:
                    rel_trust = float(rel_data) if rel_data else 0.3
                    rel_type = "stranger"
                
                if rel_trust <= -0.3 or rel_type == "enemy":  # Enemy
                    has_enemy = True
                    break
                elif rel_type in ("close_friend", "partner", "dating"):
                    relationship_bonus += 2.0
                elif rel_trust > 0.3:
                    relationship_bonus += rel_trust - 0.3
                elif rel_trust < 0.3:
                    relationship_bonus -= (0.3 - rel_trust)
            if has_enemy:
                continue

            route_distance = self._route_distance(current_loc_id, loc_id)
            distance_cost = 1.0 if route_distance is None else min(1.0, route_distance / max_route_distance)
            crowd_penalty = occupants / capacity if capacity > 0 else 1.0
            # NPCs strongly prefer their own home for house-type activities
            home_bonus = 5.0 if (home_loc_id is not None and loc_id == home_loc_id) else 0.0
            score = (
                activity_match
                + preference_match
                + relationship_bonus
                - distance_cost
                - crowd_penalty
                + home_bonus
                + random.uniform(-0.05, 0.05)
            )
            scored.append((score, loc_id))
        return scored

    def _choose_location(self, npc: dict, activity: str):
        def get_rel_trust(rel_data):
            """Extract trust value from relationship data (handles both dict and float)."""
            if isinstance(rel_data, dict):
                return rel_data.get("trust", 0.0)
            return float(rel_data) if rel_data else 0.3
        
        def get_rel_type(rel_data):
            """Extract type from relationship data (handles both dict and float)."""
            if isinstance(rel_data, dict):
                return rel_data.get("type", "stranger")
            return "stranger"
        
        if activity == "idle":
            return npc["current_location"]
        if activity == "wander":
            candidates = [
                loc_id for loc_id, loc in self._locations.items() if loc.get("occupants", 0) < loc.get("capacity", 1)
            ]
            return random.choice(candidates) if candidates else npc["current_location"]

        if activity == "birth_prep":
            birth_event_id = npc.get("birth_event_id")
            for event in self._pending_births():
                if event.get("id") == birth_event_id and not event.get("completed"):
                    return event.get("hospital_id")
            return npc["current_location"]

        if activity == "work":
            if npc.get("job_type") == "builder_hq":
                construction_site_id = self._pick_construction_site_for_builder(npc)
                if construction_site_id is not None:
                    return construction_site_id
            job_location = self._ensure_npc_job(npc)
            if job_location is not None:
                return job_location

        # For sleep, strongly prefer going home directly
        if activity == "sleep":
            home_id = npc.get("home_location")
            enemy_at_home = False
            if home_id is not None:
                for other in self._npcs.values():
                    if other["id"] == npc["id"]:
                        continue
                    if other.get("home_location") == home_id or other.get("current_location") == home_id:
                        rel_data = npc.get("relationships", {}).get(str(other["id"]), {})
                        if get_rel_trust(rel_data) <= -0.3 or get_rel_type(rel_data) == "enemy":
                            enemy_at_home = True
                            break
            
            if enemy_at_home:
                other_residents = sum(1 for other in self._npcs.values() if other["id"] != npc["id"] and other.get("home_location") == home_id)
                if other_residents == 0:
                    npc["money"] = npc.get("money", 0.0) + 50.0
                npc["home_location"] = None
                home_id = None
                
            if home_id is not None:
                living_with_lover = False
                for other in self._npcs.values():
                    if other["id"] == npc["id"]:
                        continue
                    if other.get("home_location") == home_id or other.get("current_location") == home_id:
                        rel_data = npc.get("relationships", {}).get(str(other["id"]), {})
                        if get_rel_type(rel_data) in ("partner", "dating"):
                            living_with_lover = True
                            break
                
                if not living_with_lover:
                    best_lover_home = None
                    for loc_id, loc in self._locations.items():
                        if loc.get("type") != "house":
                            continue
                        if loc.get("occupants", 0) >= loc.get("capacity", 1):
                            continue
                            
                        has_lover = False
                        has_hated = False
                        for other in self._npcs.values():
                            if other["id"] == npc["id"]:
                                continue
                            if other.get("home_location") == loc_id or other.get("current_location") == loc_id:
                                rel_data = npc.get("relationships", {}).get(str(other["id"]), {})
                                rel_trust = get_rel_trust(rel_data)
                                rel_type = get_rel_type(rel_data)
                                if rel_trust <= -0.2 or rel_type in ("enemy", "rival"):
                                    has_hated = True
                                    break
                                elif rel_type in ("partner", "dating"):
                                    has_lover = True
                                    
                        if has_lover and not has_hated:
                            best_lover_home = loc_id
                            break
                            
                    if best_lover_home is not None:
                        # Ensure int comparison for robustness
                        b_id_int = int(best_lover_home) if isinstance(best_lover_home, (str, int)) and str(best_lover_home).isdigit() else best_lover_home
                        other_residents = sum(1 for other in self._npcs.values() if other["id"] != npc["id"] and other.get("home_location") == b_id_int)
                        # If he/she was living alone, moving in together might involve a "buyout" or just free?
                        # Let's keep the existing logic but fix the var
                        if other_residents == 0:
                            npc["money"] = npc.get("money", 0.0) + 50.0
                        npc["home_location"] = best_lover_home
                        home_id = best_lover_home
                
            if home_id is None:
                residents_by_house = {}
                for other in self._npcs.values():
                    h = other.get("home_location")
                    if h is not None:
                        residents_by_house[h] = residents_by_house.get(h, 0) + 1
                
                # Try to find a home through social connections or buying
                new_home = self._try_buy_home(npc, residents_by_house)
                if new_home:
                    return new_home
                        
                # If cannot buy, try moving in with friends
                valid_homes = []
                for loc_id, loc in self._locations.items():
                    if loc.get("type") != "house":
                        continue
                    # Ensure int comparison
                    id_int = int(loc_id) if isinstance(loc_id, (str, int)) and str(loc_id).isdigit() else loc_id
                    residents = residents_by_house.get(id_int, 0)
                    if residents >= loc.get("capacity", 1):
                        continue
                    
                    has_enemy = False
                    has_close_friend = False
                    for other in self._npcs.values():
                        if other["id"] == npc["id"]:
                            continue
                        if other.get("home_location") == id_int or other.get("current_location") == id_int:
                            # Direct dict access for relationships
                            rel_data = npc.get("relationships", {}).get(str(other["id"]), {})
                            if isinstance(rel_data, dict):
                                rel_trust = rel_data.get("trust", 0.0)
                                rel_type = rel_data.get("type", "stranger")
                            else:
                                rel_trust = float(rel_data) if rel_data else 0.3
                                rel_type = "stranger"
                                
                            if rel_trust <= -0.3 or rel_type == "enemy":
                                has_enemy = True
                                break
                            elif rel_type in ("close_friend", "partner", "dating"):
                                has_close_friend = True
                    if not has_enemy and has_close_friend:
                        valid_homes.append(loc_id)
                
                if valid_homes:
                    new_home_id = random.choice(valid_homes)
                    npc["home_location"] = new_home_id
                    return new_home_id
                else:
                    parks = [lid for lid, l in self._locations.items() if l.get("type") == "park" and l.get("occupants", 0) < l.get("capacity", 1)]
                    if parks:
                        return random.choice(parks)
                        
            if home_id is not None:
                home_loc = self._locations.get(home_id)
                if home_loc and home_loc.get("occupants", 0) < home_loc.get("capacity", 1):
                    return home_id

        scored = self._score_locations(npc, activity)
        if not scored:
            npc["activity"] = "wander"
            candidates = [
                loc_id for loc_id, loc in self._locations.items() if loc.get("occupants", 0) < loc.get("capacity", 1)
            ]
            return random.choice(candidates) if candidates else npc["current_location"]
        scored.sort(key=lambda item: item[0], reverse=True)
        return scored[0][1]

    def _try_buy_home(self, npc: dict, residents_by_house: dict = None) -> Optional[int]:
        """Attempt to buy a vacant house for an NPC."""
        if residents_by_house is None:
            residents_by_house = {}
            for other in self._npcs.values():
                h = other.get("home_location")
                if h is not None:
                    # Ensure int keys
                    h_int = int(h) if isinstance(h, (str, int)) and str(h).isdigit() else h
                    residents_by_house[h_int] = residents_by_house.get(h_int, 0) + 1

        abandoned_homes = []
        for loc_id, loc in self._locations.items():
            if loc.get("type") == "house":
                # Ensure int comparison
                id_int = int(loc_id) if isinstance(loc_id, (str, int)) and str(loc_id).isdigit() else loc_id
                if residents_by_house.get(id_int, 0) == 0:
                    abandoned_homes.append(id_int)

        # Cost to buy an empty house: 50
        if abandoned_homes and npc.get("money", 0.0) >= 50.0:
            new_home_id = random.choice(abandoned_homes)
            npc["money"] -= 50.0
            npc["home_location"] = new_home_id
            print(f"[Plugin:World] {npc['name']} bought a new home: House #{new_home_id}")
            return new_home_id
        return None

    def _remove_npc_from_location(self, npc, location_id):
        loc = self._locations.get(location_id)
        if not loc:
            return
        loc["occupants"] = max(0, loc.get("occupants", 0) - 1)
        occ = loc.setdefault("occupant_ids", [])
        if npc["id"] in occ:
            occ.remove(npc["id"])

    def _add_npc_to_location(self, npc, location_id):
        loc = self._locations.get(location_id)
        if not loc:
            return
        loc["occupants"] = loc.get("occupants", 0) + 1
        occ = loc.setdefault("occupant_ids", [])
        if npc["id"] not in occ:
            occ.append(npc["id"])

    def _movement_mode_for_npc(self, npc):
        if self._simulation_speed >= FAST_TRAVEL_THRESHOLD:
            return "instant"
        if any(value >= RUN_NEED_THRESHOLD for value in npc.get("needs", {}).values()):
            return "run"
        return "walk"

    def _movement_speed_px_per_sec(self, mode):
        multiplier = max(1.0, min(4.0, self._simulation_speed))
        if mode == "run":
            return RUN_SPEED_PX_PER_SEC * multiplier
        return WALK_SPEED_PX_PER_SEC * multiplier

    def _complete_npc_movement(self, npc, target_location):
        movement = npc["movement"]
        movement["active"] = False
        movement["mode"] = "idle"
        movement["progress_px"] = movement.get("distance_px", 0.0)
        movement["speed_px_per_sec"] = 0.0
        movement["render_position"] = None
        movement["route_points"] = []
        movement["distance_px"] = 0.0
        movement["origin_location"] = target_location
        movement["target_location"] = target_location
        npc["current_location"] = target_location
        npc["activity"] = movement.get("activity_at_target", npc.get("activity", "idle"))
        self._add_npc_to_location(npc, target_location)
        npc["_arrived_this_tick"] = True

    def _begin_npc_movement(self, npc, target_location, activity):
        from_location = npc["current_location"]
        if from_location == target_location:
            return
        mode = self._movement_mode_for_npc(npc)
        route = self._street_router.route_between_locations(from_location, target_location) if self._street_router else None
        if mode == "instant" or route is None or route["distance_px"] <= 1e-6:
            self._remove_npc_from_location(npc, from_location)
            npc["movement"]["activity_at_target"] = activity
            self._complete_npc_movement(npc, target_location)
            return

        self._remove_npc_from_location(npc, from_location)
        npc["activity"] = activity
        movement = npc["movement"]
        movement["active"] = True
        movement["mode"] = mode
        movement["origin_location"] = from_location
        movement["target_location"] = target_location
        movement["route_points"] = route["route_points"]
        movement["distance_px"] = route["distance_px"]
        movement["progress_px"] = 0.0
        movement["speed_px_per_sec"] = self._movement_speed_px_per_sec(mode)
        movement["render_position"] = _point_on_polyline(route["route_points"], 0.0)
        movement["activity_at_target"] = activity

    def _advance_npc_movement(self, npc, delta_seconds):
        movement = npc["movement"]
        if not movement.get("active"):
            return
        desired_mode = self._movement_mode_for_npc(npc)
        if desired_mode == "instant":
            self._complete_npc_movement(npc, movement["target_location"])
            return

        movement["mode"] = desired_mode
        movement["speed_px_per_sec"] = self._movement_speed_px_per_sec(desired_mode)
        next_progress = movement.get("progress_px", 0.0) + movement["speed_px_per_sec"] * max(0.0, delta_seconds)
        movement["progress_px"] = min(movement.get("distance_px", 0.0), next_progress)
        movement["render_position"] = _point_on_polyline(
            movement.get("route_points", []),
            movement.get("progress_px", 0.0),
        )
        if movement["progress_px"] >= movement.get("distance_px", 0.0) - 1e-6:
            self._complete_npc_movement(npc, movement["target_location"])

    def _move_npc(self, npc: dict, target_location: int):
        """Legacy helper kept for compatibility with old tests and callers."""
        from_id = npc["current_location"]
        if from_id == target_location:
            return
        self._remove_npc_from_location(npc, from_id)
        npc["current_location"] = target_location
        self._add_npc_to_location(npc, target_location)

    def _perform_activity(self, npc: dict, activity: str, world_hours_delta=1.0):
        reductions = ACTIVITY_NEED_REDUCTION.get(activity)
        if reductions is None:
            return
            
        needs = npc["needs"]
        loc = self._locations.get(npc.get("current_location", -1), {})
        loc_type = loc.get("type")

        # Special logic for money and multipliers
        hunger_reduction_mult = 1.0
        if activity == "eat":
            price = FOOD_PRICES.get(loc_type, 0.0)
            npc["money"] = max(0.0, npc.get("money", 0.0) - price * world_hours_delta)
            if price == 0.0:
                hunger_reduction_mult = 0.5
            else:
                hunger_reduction_mult = 1.5
        elif activity == "work":
            wage_key = loc_type
            if loc_type == "construction_site" and npc.get("job_type") == "builder_hq":
                wage_key = "builder_hq"
            wage = WORK_WAGES.get(wage_key, 0.0)
            npc["money"] = npc.get("money", 0.0) + wage * world_hours_delta
            if loc_type == "construction_site" and npc.get("job_type") == "builder_hq":
                loc["construction_progress_hours"] = loc.get("construction_progress_hours", 0.0) + world_hours_delta
                loc["construction_status"] = "building"
                if loc.get("construction_progress_hours", 0.0) >= loc.get("construction_required_hours", float("inf")):
                    self._complete_construction_site(loc["id"])

        for need_key, reduction in reductions:
            if need_key in needs:
                final_reduction = reduction
                if activity == "eat" and need_key == "hunger":
                    final_reduction *= hunger_reduction_mult
                
                needs[need_key] = max(0.0, min(1.0, needs[need_key] + final_reduction * world_hours_delta))

    def _make_social_pair_state(self, partner_id: int, outcome_roll: float, category: str | None = None) -> dict:
        pair = {
            "partner_id": partner_id,
            "progress": 0.0,
            "start_tick": self._tick_count,
            "outcome_roll": float(outcome_roll),
            "preview_badge": None,
        }
        if category is not None:
            pair["category"] = category
        return pair

    def _resolve_pair_relationship_type(self, rel_a: dict, rel_b: dict) -> str:
        """Resolve the displayed relationship type for a pair from both perspectives."""
        type_order = [
            "partner",
            "dating",
            "crush",
            "enemy",
            "rival",
            "close_friend",
            "friend",
            "ex",
            "acquaintance",
            "stranger",
        ]
        type_a = rel_a.get("type", "stranger")
        type_b = rel_b.get("type", "stranger")
        if type_a in ("partner", "dating") or type_b in ("partner", "dating"):
            return "partner" if "partner" in (type_a, type_b) else "dating"
        if type_a in ("enemy", "rival") or type_b in ("enemy", "rival"):
            return "enemy" if "enemy" in (type_a, type_b) else "rival"
        priority_a = type_order.index(type_a) if type_a in type_order else len(type_order) - 1
        priority_b = type_order.index(type_b) if type_b in type_order else len(type_order) - 1
        return type_order[max(priority_a, priority_b)]

    def _relationship_stage_value(self, rel_type: str) -> int:
        return {
            "enemy": -3,
            "rival": -2,
            "ex": -1,
            "stranger": 0,
            "acquaintance": 1,
            "friend": 2,
            "close_friend": 3,
            "crush": 4,
            "dating": 5,
            "partner": 6,
        }.get(rel_type, 0)

    def _build_pair_preview_badge(self, before_type: str, after_type: str) -> dict | None:
        if before_type == after_type:
            return None
        meta = {
            "acquaintance": {"icon": "✨", "label": "Quen biết", "color": "#ffd166"},
            "friend": {"icon": "🤝", "label": "Bạn bè", "color": "#6ecbff"},
            "close_friend": {"icon": "🌟", "label": "Bạn thân", "color": "#37d39f"},
            "crush": {"icon": "💕", "label": "Cảm nắng", "color": "#ff8cc6"},
            "dating": {"icon": "💖", "label": "Người yêu", "color": "#ff63b8"},
            "partner": {"icon": "💍", "label": "Bạn đời", "color": "#ff5e7c"},
            "rival": {"icon": "⚡", "label": "Kình địch", "color": "#ffad33"},
            "enemy": {"icon": "💢", "label": "Kẻ thù", "color": "#ff5a5a"},
            "ex": {"icon": "💔", "label": "Người cũ", "color": "#b8a7ff"},
            "stranger": {"icon": "🫥", "label": "Xa lạ", "color": "#c7c7c7"},
        }.get(after_type, {"icon": "✨", "label": after_type.capitalize(), "color": "#ffffff"})
        trend = "up" if self._relationship_stage_value(after_type) >= self._relationship_stage_value(before_type) else "down"
        return {
            "icon": meta["icon"],
            "label": meta["label"],
            "color": meta["color"],
            "trend": trend,
            "text": f"{meta['icon']} {meta['label']} {'⬆️' if trend == 'up' else '⬇️'}",
        }

    def _get_social_pair_success(self, npc: dict, partner: dict, pair: dict) -> bool:
        compat = ZODIAC_COMPATIBILITY[npc.get("zodiac_index", 0)][partner.get("zodiac_index", 0)]
        roll = float(pair.get("outcome_roll", random.random()))
        pair["outcome_roll"] = roll
        return roll < compat

    def _ensure_social_pair_preview(self, npc: dict, pair: dict):
        """Attach a stable preview badge near the end of a pair interaction."""
        if pair.get("preview_badge") or pair.get("progress", 0.0) < 0.7:
            return

        partner_id = pair.get("partner_id")
        if partner_id is None or partner_id not in self._npcs:
            return

        partner = self._npcs[partner_id]
        partner_pair = partner.get("social_pair")
        if not partner_pair:
            return

        npc_rel = self._relationship_engine.get_or_create_relationship(npc, partner_id)
        partner_rel = self._relationship_engine.get_or_create_relationship(partner, npc["id"])
        success = self._get_social_pair_success(npc, partner, pair)
        partner_pair["outcome_roll"] = pair["outcome_roll"]

        change_type = "positive_interaction" if success else "negative_interaction"
        npc_preview = self._relationship_engine.preview_relationship_change(
            npc_rel, change_type, npc.get("personality", {})
        )
        partner_preview = self._relationship_engine.preview_relationship_change(
            partner_rel, change_type, partner.get("personality", {})
        )

        before_type = self._resolve_pair_relationship_type(npc_rel, partner_rel)
        after_type = self._resolve_pair_relationship_type(
            npc_preview["relationship"],
            partner_preview["relationship"],
        )
        badge = self._build_pair_preview_badge(before_type, after_type)
        if not badge:
            return

        pair["preview_badge"] = copy.deepcopy(badge)
        partner_pair["preview_badge"] = copy.deepcopy(badge)

    def _handle_npc_social_progression(self, npc, world_hours_delta):
        """Increase social pair progress and resolve if finished."""
        pair = npc["social_pair"]
        
        # Check for exhaustion at night: cancel pair and go to sleep
        current_hour = int(self._world_seconds % (24 * 3600)) // 3600
        if (current_hour >= 22 or current_hour < 6) and npc["needs"].get("rest", 0.0) >= 0.8:
            partner_id = pair.get("partner_id")
            npc["social_pair"] = None
            
            # Find and update partner
            if partner_id is not None and partner_id in self._npcs:
                partner = self._npcs[partner_id]
                partner["social_pair"] = None
                if partner.get("activity") == "socializing":
                    partner["activity"] = "idle"
            
            # Switch to sleep state
            npc["activity"] = "sleep"
            target_loc = self._choose_location(npc, "sleep")
            if target_loc is not None and target_loc != npc["current_location"]:
                self._begin_npc_movement(npc, target_loc, "sleep")
            else:
                # Already at a sleeping location
                npc["_stay_until_world_sec"] = self._world_seconds + 8.0 * 3600.0
            return

        pair["progress"] = min(1.0, pair.get("progress", 0.0) + world_hours_delta * 0.5) # takes 2 world hours to complete
        self._ensure_social_pair_preview(npc, pair)
        
        if pair["progress"] < 1.0:
            partner_id = pair.get("partner_id")
            if partner_id is not None and partner_id in self._npcs:
                partner = self._npcs[partner_id]
                compat = ZODIAC_COMPATIBILITY[npc.get("zodiac_index", 0)][partner.get("zodiac_index", 0)]
                is_a = npc["id"] < partner_id
                
                # 2 world hours = 120 minutes. 5 min per topic -> 24 turns
                turn = int(pair["progress"] * 24)
                i_am_speaker = (turn % 2 == 0) if is_a else (turn % 2 == 1)
                pair["role"] = "speaker" if i_am_speaker else "listener"
                
                topic_seed = pair.get("start_tick", 0) + turn
                if i_am_speaker:
                    cat = pair.get("category", "socialize")
                    if cat == "sleep":
                        topics = ["💤", "🛌", "🌙", "😴", "☁️"]
                    elif cat == "work":
                        topics = ["💼", "💻", "📈", "🗂️", "📋"]
                    elif cat == "shop":
                        topics = ["🛒", "🛍️", "💸", "👗", "🎁"]
                    elif cat == "eat":
                        topics = ["🍔", "🍕", "🍜", "🍰", "🍵"]
                    else:
                        topics = ["💬", "🎬", "🎵", "🎮", "⚽", "📚"]
                    pair["icon"] = topics[topic_seed % len(topics)]
                else:
                    if compat >= 0.8:
                        rxns = ["💖", "✨"]
                    elif compat >= 0.6:
                        rxns = ["✨", "💭"]
                    else:
                        rxns = ["💢", "💦"]
                    pair["icon"] = rxns[topic_seed % len(rxns)]
                    
            if npc.get("activity") and npc["activity"] != "socializing":
                self._perform_activity(npc, npc["activity"], world_hours_delta)
                
        if pair["progress"] >= 1.0:
            # End social
            partner_id = pair.get("partner_id")
            npc["social_pair"] = None
            
            # Apply relationship changes using new system
            if partner_id is not None and partner_id in self._npcs:
                partner = self._npcs[partner_id]
                # Get or create relationships
                npc_rel = self._relationship_engine.get_or_create_relationship(npc, partner_id)
                partner_rel = self._relationship_engine.get_or_create_relationship(partner, npc["id"])
                
                # Determine interaction outcome based on compatibility and mood
                success = self._get_social_pair_success(npc, partner, pair)
                self._maybe_schedule_birth_from_sleep_pair(npc, partner, pair, success)
                
                # Get personality modifiers
                npc_personality = npc.get("personality", {})
                partner_personality = partner.get("personality", {})
                
                # Apply relationship change
                change_type = "positive_interaction" if success else "negative_interaction"
                self._relationship_engine.apply_relationship_change(
                    npc, partner_id, change_type, npc_personality
                )
                self._relationship_engine.apply_relationship_change(
                    partner, npc["id"], change_type, partner_personality
                )
                
                # Create memories for both NPCs
                interaction_type = "positive" if success else "negative"
                self._memory_engine.create_interaction_memory(
                    npc, partner, interaction_type,
                    npc.get("current_location"),
                    self._tick_count,
                    outcome="success" if success else "failure",
                )
                
                # Apply mood effects
                self._mood_engine.process_interaction_outcome(
                    npc, partner, "positive" if success else "negative",
                    "success" if success else "failure"
                )
                self._mood_engine.process_interaction_outcome(
                    partner, npc, "positive" if success else "negative",
                    "success" if success else "failure"
                )
                
                # Reduce social need
                npc["needs"]["social"] = max(0.0, npc["needs"].get("social", 0.0) - 0.5)
                    
                npc["last_location_interaction_tick"] = self._tick_count
                npc["last_road_interaction_tick"] = self._tick_count
                
                # Resume movement if still on the road
                if npc["movement"].get("route_points"):
                    npc["movement"]["active"] = True
                
                # Resume idle to pick a new activity next tick
                if npc["activity"] == "socializing":
                    npc["activity"] = "idle"

    def _seed_initial_social_connections(self):
        mode = str(self._config.get("socializeMode", "None") or "None").capitalize()
        if mode not in {"Half", "Full"}:
            return

        npc_ids = list(self._npcs.keys())
        if len(npc_ids) < 2:
            return

        rng_seed = int(self._map.get("seed", self._config.get("seed") or 0)) + 991
        rng = random.Random(rng_seed)
        rng.shuffle(npc_ids)

        if mode == "Half":
            paired_npc_count = max(0, int(len(npc_ids) * 0.5))
        else:
            paired_npc_count = len(npc_ids)
        paired_npc_count -= paired_npc_count % 2

        for idx in range(0, paired_npc_count, 2):
            left = self._npcs[npc_ids[idx]]
            right = self._npcs[npc_ids[idx + 1]]

            left_rel = self._relationship_engine.get_or_create_relationship(left, right["id"])
            right_rel = self._relationship_engine.get_or_create_relationship(right, left["id"])

            relationship_type = "partner" if rng.random() < 0.35 else "dating"
            trust = 0.74 if relationship_type == "dating" else 0.9
            attraction = 0.78 if relationship_type == "dating" else 0.92
            familiarity = 0.72 if relationship_type == "dating" else 0.88
            respect = 0.62 if relationship_type == "dating" else 0.8

            for rel in (left_rel, right_rel):
                rel["type"] = relationship_type
                rel["trust"] = trust
                rel["attraction"] = attraction
                rel["familiarity"] = familiarity
                rel["respect"] = respect
                rel.setdefault("history", []).append({
                    "event": "initial_relationship_seed",
                    "partner_id": right["id"] if rel is left_rel else left["id"],
                    "type": relationship_type,
                })

            left["partner_id"] = right["id"]
            right["partner_id"] = left["id"]
            if relationship_type == "dating":
                start_tick = -rng.randint(24, 240)
                left["dating_since_tick"] = start_tick
                right["dating_since_tick"] = start_tick
            else:
                left["dating_since_tick"] = -rng.randint(240, 720)
                right["dating_since_tick"] = left["dating_since_tick"]

            # Seeded couples should be more likely to cohabit so they can actually sleep together.
            self._invite_to_move_in(left["id"], right["id"])

    def _init_npcs_from_spawns(self, map_data: dict):
        seed = map_data.get("seed", self._config.get("seed"))
        self._npcs = build_npcs_from_spawns(
            map_data,
            seed=seed,
            core_api=self._core_api,
            personality_profile=self._config.get("personalityProfile"),
            assign_home=bool(self._config.get("assignHome", True)),
        )
        for npc in self._npcs.values():
            self._normalize_loaded_npc(npc)
            self._ensure_npc_job(npc)
        self._seed_initial_social_connections()

        # Name houses after occupants and add default names for others
        type_counters = {}
        for loc_id, loc in self._locations.items():
            l_type = loc.get("type", "building")
            if l_type == "house":
                # Find who lives here
                residents = [n["name"] for n in self._npcs.values() if n.get("home_location") == loc_id]
                if residents:
                    if len(residents) <= 2:
                        loc["name"] = f"{' & '.join(residents)}"
                    else:
                        loc["name"] = f"{residents[0]} & {len(residents)-1} người khác"
                else:
                    loc["name"] = f"Trống #{loc_id}"
            else:
                # Other types: e.g. "Cafe #1"
                count = type_counters.get(l_type, 0) + 1
                type_counters[l_type] = count
                type_display = {
                    "cafe": "Cafe", "shop": "Cửa hàng", "school": "Trường học",
                    "park": "Công viên", "shrine": "Đền thờ", "library": "Thư viện",
                    "gym": "Phòng gym", "arcade": "Khu trò chơi", "hospital": "Bệnh viện",
                    "office": "Văn phòng", "factory": "Nhà máy", "studio": "Studio",
                    "museum": "Bảo tàng", "cinema": "Rạp phim", "builder_hq": "Trạm xây dựng",
                    "construction_site": "Công trường",
                }.get(l_type, l_type.capitalize())
                loc["name"] = f"{type_display} #{count}"

    def _build_location_index(self, map_data: dict):
        self._locations, self._pathfinder = build_location_index(map_data)
        self._street_router = build_street_router(map_data)

    def _name_houses_after_occupants(self):
        """Set house names based on current residents."""
        type_counters = {}
        for loc_id, loc in self._locations.items():
            l_type = loc.get("type", "building")
            if l_type == "house":
                # Legal residents (those who own/live in this home)
                # Ensure int comparison for robustness
                id_int = int(loc_id) if isinstance(loc_id, (str, int)) and str(loc_id).isdigit() else loc_id
                residents = [n["name"] for n in self._npcs.values() if n.get("home_location") == id_int]
                
                if residents:
                    if len(residents) <= 2:
                        loc["name"] = f"{' & '.join(residents)}"
                    else:
                        loc["name"] = f"{residents[0]} & {len(residents)-1} người khác"
                else:
                    # No legal residents. Check if anyone is physically present.
                    current_visitors = [n["name"] for n in self._npcs.values() if n.get("current_location") == id_int]
                    if current_visitors:
                        loc["name"] = f"Khách: {', '.join(current_visitors[:2])}"
                    else:
                        loc["name"] = f"Trống #{loc_id}"
            else:
                count = type_counters.get(l_type, 0) + 1
                type_counters[l_type] = count
                type_display = {
                    "cafe": "Cafe", "shop": "Cửa hàng", "school": "Trường học",
                    "park": "Công viên", "shrine": "Đền thờ", "library": "Thư viện",
                    "gym": "Phòng gym", "arcade": "Khu trò chơi", "hospital": "Bệnh viện",
                    "office": "Văn phòng", "factory": "Nhà máy", "studio": "Studio",
                    "museum": "Bảo tàng", "cinema": "Rạp phim"
                }.get(l_type, l_type.capitalize())
                loc["name"] = f"{type_display} #{count}"

    def _process_social_dynamics(self, world_hours_delta: float):
        """Process all social dynamics: groups, rumors, conflicts, romantic progression."""
        # Check for group formation
        self._social_dynamics.check_group_formation(self._npcs, self._locations)
        
        # Spread rumors
        self._social_dynamics.spread_rumors(self._npcs, self._locations)
        
        # Check romantic progression for all pairs
        events = []
        processed_pairs = set()
        
        for npc_id, npc in self._npcs.items():
            for other_id_str, rel in npc.get("relationships", {}).items():
                other_id = int(other_id_str)
                pair_key = tuple(sorted([npc_id, other_id]))
                if pair_key in processed_pairs:
                    continue
                processed_pairs.add(pair_key)
                
                other = self._npcs.get(other_id)
                if not other:
                    continue
                
                other_rel = other.get("relationships", {}).get(str(npc_id), {})
                same_location = npc.get("current_location") == other.get("current_location")
                hours_together = world_hours_delta if same_location else 0
                
                pair_events = self._social_dynamics.check_romantic_progression(
                    npc, other, rel, other_rel, hours_together, world_hours_delta
                )
                
                # Process romantic events
                for event in pair_events:
                    if event["type"] in ("became_partner", "confession_success"):
                        # Try to move in together
                        self._invite_to_move_in(npc["id"], other_id)
                events.extend(pair_events)
            
            # Periodically check for couples in separate homes to move in together
            # Only for dating/partner status
            if npc.get("home_location") is not None:
                for target_id_str, rel in npc.get("relationships", {}).items():
                    target_id = int(target_id_str)
                    if target_id <= npc["id"]: # Process each pair once
                        continue
                    if rel.get("type") in ("dating", "partner") and rel.get("trust", 0) > 0.7:
                        # Chance per world-hour to consider moving in
                        if random.random() < 0.08 * world_hours_delta:
                            # Verify target is still in self._npcs
                            if target_id in self._npcs:
                                self._invite_to_move_in(npc["id"], target_id)
        
        # Process events (silent - no console output)
        
        # Check for spontaneous conflicts
        by_location = {}
        for npc in self._npcs.values():
            if npc["movement"]["active"] or npc.get("social_pair"):
                continue
            by_location.setdefault(npc["current_location"], []).append(npc)
        
        for loc_id, npcs_at_loc in by_location.items():
            for i, npc_a in enumerate(npcs_at_loc):
                for npc_b in npcs_at_loc[i+1:]:
                    self._social_dynamics.check_spontaneous_conflict(
                        npc_a, npc_b, self._locations.get(loc_id, {}).get("type", "")
                    )
        
        # Process existing conflicts
        for conflict_id, conflict in list(self._social_dynamics.get_conflicts().items()):
            if conflict.get("status") != "active":
                continue
            parties = conflict.get("parties", [])
            if len(parties) != 2:
                continue
            npc_a = self._npcs.get(parties[0])
            npc_b = self._npcs.get(parties[1])
            if not npc_a or not npc_b:
                continue
            
            self._social_dynamics.check_conflict_escalation(conflict, npc_a, npc_b)
            
            if random.random() < 0.1:
                self._social_dynamics.attempt_conflict_resolution(conflict, npc_a, npc_b)
    
    def _check_home_leaving(self, world_hours_delta: float):
        """Check if any NPCs should leave their homes."""
        for npc_id, npc in list(self._npcs.items()):
            leaving = self._social_dynamics.check_home_leaving(npc, self._npcs, self._locations, world_hours_delta)
            if leaving:
                trigger = leaving.get("trigger")
                old_home = leaving.get("old_home")
                npc["home_location"] = None
                if trigger == "financial_opportunity":
                    npc["money"] += 100.0
                self._memory_engine.create_event_memory(
                    npc, event_type="home_leaving", tick=self._tick_count,
                    summary=f"Left home due to {trigger}", location_id=old_home,
                )
    
    def get_social_state(self) -> dict:
        """Get social dynamics state for serialization."""
        return self._social_dynamics.get_state()
    
    def get_npc_relationships_summary(self, npc_id: int) -> dict:
        """Get a summary of an NPC's relationships."""
        npc = self._npcs.get(npc_id)
        if not npc:
            return {}
        relationships = npc.get("relationships", {})
        summary = {"total": len(relationships), "by_type": {}, "partners": [], "enemies": [], "close_friends": []}
        for other_id_str, rel in relationships.items():
            rel_type = rel.get("type", "stranger")
            summary["by_type"][rel_type] = summary["by_type"].get(rel_type, 0) + 1
            if rel_type == "partner":
                summary["partners"].append(int(other_id_str))
            elif rel_type == "enemy":
                summary["enemies"].append(int(other_id_str))
            elif rel_type == "close_friend":
                summary["close_friends"].append(int(other_id_str))
        return summary

    def _invite_to_move_in(self, npc_a_id: int, npc_b_id: int):
        """Attempt to have two romantic partners move in together."""
        npc_a = self._npcs.get(npc_a_id)
        npc_b = self._npcs.get(npc_b_id)
        if not npc_a or not npc_b:
            return
            
        home_a = npc_a.get("home_location")
        home_b = npc_b.get("home_location")
        
        # Already sharing a home?
        if home_a is not None and home_a == home_b:
            return
            
        # Check if relationship is stable/high enough to move in
        rel = npc_a.get("relationships", {}).get(str(npc_b_id), {})
        if not isinstance(rel, dict): 
            return # Old format relationship
            
        rel_type = rel.get("type", "stranger")
        if rel_type == "partner":
            trust_threshold = 0.68
            familiarity_threshold = 0.65
        elif rel_type == "dating":
            trust_threshold = 0.58
            familiarity_threshold = 0.58
        else:
            return

        if rel.get("trust", 0) < trust_threshold or rel.get("familiarity", 0) < familiarity_threshold:
            return
            
        # Consider available homes
        loc_a = self._locations.get(home_a) if home_a is not None else None
        loc_b = self._locations.get(home_b) if home_b is not None else None
        
        # Room in A?
        can_move_to_a = loc_a and loc_a.get("occupants", 0) < loc_a.get("capacity", 1)
        # Room in B?
        can_move_to_b = loc_b and loc_b.get("occupants", 0) < loc_b.get("capacity", 1)
        
        target_home = None
        moving_npc = None
        other_npc = None
        
        if can_move_to_a and can_move_to_b:
            # Both have space. Pick based on capacity or randomly.
            if loc_a["capacity"] >= loc_b["capacity"]:
                target_home = home_a
                moving_npc = npc_b
                other_npc = npc_a
            else:
                target_home = home_b
                moving_npc = npc_a
                other_npc = npc_b
        elif can_move_to_a:
            target_home = home_a
            moving_npc = npc_b
            other_npc = npc_a
        elif can_move_to_b:
            target_home = home_b
            moving_npc = npc_a
            other_npc = npc_b
            
        if target_home is not None and moving_npc is not None:
            # Moving in together is a big deal!
            moving_npc["home_location"] = target_home
            moving_npc.pop("_stay_until_world_sec", None) # Force recalculating schedule
            
            # Log the event
            print(f"[Plugin:World] {moving_npc['name']} moved in with {other_npc['name']} at House #{target_home}")
            self._memory_engine.create_event_memory(
                moving_npc, event_type="home_joining", tick=self._tick_count,
                summary=f"Moved in with partner {other_npc['name']} at House #{target_home}", location_id=target_home,
            )
            self._memory_engine.create_event_memory(
                other_npc, event_type="home_joining", tick=self._tick_count,
                summary=f"Partner {moving_npc['name']} moved in with me at House #{target_home}", location_id=target_home,
            )
            # Both NPCs get a mood boost
            self._mood_engine.set_mood(npc_a, "happy", 0.7, cause="moving_in", duration_ticks=20)
            self._mood_engine.set_mood(npc_b, "happy", 0.7, cause="moving_in", duration_ticks=20)

    def _try_buy_home(self, npc: dict, residents_by_house: dict = None) -> Optional[int]:
        """Homeless NPC attempts to buy a house. Returns home_id if successful."""
        if npc.get("home_location") is not None:
            return None
            
        # Need enough money to buy (Base: 150)
        if npc.get("money", 0) < 150.0:
            return None
            
        # Find empty houses
        empty_houses = []
        for loc_id, loc in self._locations.items():
            if loc.get("type") != "house":
                continue
            
            # Use cached counts if available, else count manually
            if residents_by_house is not None:
                occupants = residents_by_house.get(loc_id, 0)
            else:
                occupants = loc.get("occupants", 0)
                
            if occupants == 0:
                empty_houses.append(loc_id)
        
        if not empty_houses:
            return None
            
        # Buy a house
        house_id = random.choice(empty_houses)
        npc["home_location"] = house_id
        npc["money"] -= 150.0
        
        print(f"[Plugin:World] {npc['name']} bought House #{house_id}")
        self._memory_engine.create_event_memory(
            npc, event_type="home_purchase", tick=self._tick_count,
            summary=f"Bought a new house (House #{house_id})", location_id=house_id,
        )
        return house_id
