import copy
import random
import threading
import time

from ..world_generator import generate_world
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
    SOCIAL_AFFINITY_GAIN_EXTROVERTED,
    SOCIAL_AFFINITY_GAIN_INTROVERTED,
    SOCIAL_AFFINITY_LOSS_EXTROVERTED,
    SOCIAL_AFFINITY_LOSS_INTROVERTED,
)
from .indexing import build_location_index, calc_world_time
from .npc_state import build_npcs_from_spawns
from .street_router import build_street_router


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


class WorldStateEngine:
    """World simulation engine with road-based NPC movement."""

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
        self._lock = threading.RLock()
        self._task = None
        self._paused = False

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

    def load_or_init(self):
        self._load_config()
        saved = self._core_api.read_data("world_state.json", default_value=None)
        if saved is not None and isinstance(saved, dict) and "map" in saved:
            with self._lock:
                self._tick_count = int(saved.get("tick_count", 0))
                legacy_minutes = self._tick_count * 30
                self._world_seconds = float(saved.get("world_seconds", legacy_minutes * 60))
                self._map = saved["map"]
                self._npcs = {int(key): value for key, value in saved.get("npcs", {}).items()}
                for npc in self._npcs.values():
                    self._normalize_loaded_npc(npc)
                self._build_location_index(self._map)
            print("[Plugin:World] World state loaded.")
            return

        generated_map = generate_world(self._config)
        with self._lock:
            self._map = generated_map
            self._tick_count = 0
            self._world_seconds = 0.0
            self._build_location_index(self._map)
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
            self._tick_count = 0
            self._world_seconds = 0.0
            self._build_location_index(self._map)
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
                self._simulation_speed = max(1.0, min(100.0, float(speed_multiplier)))
            if tick_interval_ms is not None:
                self._tick_interval_ms = max(100, int(tick_interval_ms))
                self._config["tick_interval_ms"] = self._tick_interval_ms

    def get_state(self) -> dict:
        with self._lock:
            return copy.deepcopy(
                {
                    "tick_count": self._tick_count,
                    "world_time": calc_world_time(self._world_seconds),
                    "world_time_seconds": self._world_seconds,
                    "simulation_speed": self._simulation_speed,
                    "tick_interval_ms": self._tick_interval_ms,
                    "server_time_ms": int(time.time() * 1000),
                    "map": self._map,
                    "npcs": self._npcs,
                }
            )

    def get_live_state(self) -> dict:
        with self._lock:
            return copy.deepcopy(
                {
                    "tick_count": self._tick_count,
                    "world_time": calc_world_time(self._world_seconds),
                    "world_time_seconds": self._world_seconds,
                    "simulation_speed": self._simulation_speed,
                    "tick_interval_ms": self._tick_interval_ms,
                    "server_time_ms": int(time.time() * 1000),
                    "npcs": self._npcs,
                }
            )

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
            world_hours_delta = (delta_seconds * WORLD_SECONDS_PER_REAL_SECOND_AT_X1 * self._simulation_speed) / 3600.0
            
            prev_day = int(self._world_seconds // 86400)
            self._advance_world_time(delta_seconds)
            current_day = int(self._world_seconds // 86400)

            if current_day > prev_day:
                for npc in self._npcs.values():
                    fin = npc.get("financial_plan", {})
                    if npc.get("money", 0.0) < fin.get("last_daily_balance", 0.0):
                        fin["prioritize_work"] = True
                    else:
                        fin["prioritize_work"] = False
                    fin["last_daily_balance"] = npc.get("money", 0.0)

            self._increase_needs(world_hours_delta)

            for npc in self._npcs.values():
                npc["_arrived_this_tick"] = False
                
                # Handle social pair active state
                if npc.get("social_pair"):
                    # Increase progress
                    pair = npc["social_pair"]
                    pair["progress"] = min(1.0, pair.get("progress", 0.0) + world_hours_delta * 0.5) # takes 2 world hours to complete
                    
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
                        
                        # Apply relationship changes according to traits
                        if partner_id is not None and partner_id in self._npcs:
                            extroverted = npc.get("financial_plan", {}).get("extroverted_finance", False)
                            partner = self._npcs[partner_id]
                            compat = ZODIAC_COMPATIBILITY[npc.get("zodiac_index", 0)][partner.get("zodiac_index", 0)]
                            
                            success = random.random() < compat
                            
                            relationships = npc.setdefault("relationships", {})
                            partner_str_id = str(partner_id)
                            current_rel = relationships.get(partner_str_id, 0.3)
                            
                            if success:
                                gain = SOCIAL_AFFINITY_GAIN_EXTROVERTED if extroverted else SOCIAL_AFFINITY_GAIN_INTROVERTED
                                relationships[partner_str_id] = min(1.0, current_rel + gain)
                                npc["needs"]["social"] = max(0.0, npc["needs"].get("social", 0.0) - 0.5)
                            else:
                                loss = SOCIAL_AFFINITY_LOSS_EXTROVERTED if extroverted else SOCIAL_AFFINITY_LOSS_INTROVERTED
                                relationships[partner_str_id] = max(0.0, current_rel - loss)
                                
                            npc["last_location_interaction_tick"] = self._tick_count
                            npc["last_road_interaction_tick"] = self._tick_count
                            
                            # Resume idle to pick a new activity next tick
                            if npc["activity"] == "socializing":
                                npc["activity"] = "idle"
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
                    if activity_name == "sleep":
                        current_hour = int(self._world_seconds % (24 * 3600)) // 3600
                        if 6 <= current_hour < 22:
                            duration_h = 1.0
                    elif activity_name == "work":
                        loc = self._locations.get(npc["current_location"], {})
                        duration_h = WORK_DURATIONS.get(loc.get("type"), 4.0)
                            
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
                    if activity == "sleep":
                        current_hour = int(self._world_seconds % (24 * 3600)) // 3600
                        if 6 <= current_hour < 22:
                            duration_h = 1.0
                    elif activity == "work":
                        loc = self._locations.get(npc["current_location"], {})
                        duration_h = WORK_DURATIONS.get(loc.get("type"), 4.0)
                            
                    duration_h *= random.uniform(0.8, 1.2)
                    npc["_stay_until_world_sec"] = self._world_seconds + duration_h * 3600.0
                    self._perform_activity(npc, activity, world_hours_delta)

            for npc in self._npcs.values():
                npc.pop("_arrived_this_tick", None)

            self._check_road_interactions()
            self._check_location_interactions()
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
                        
                    left_rel = left.get("relationships", {}).get(str(right["id"]), 0.3)
                    right_rel = right.get("relationships", {}).get(str(left["id"]), 0.3)
                    min_rel = min(left_rel, right_rel)
                    
                    if min_rel <= 0.1: # Enemies never pair
                        continue
                        
                    chance = 0.0
                    if category == "sleep":
                        if min_rel >= 0.85: chance = 0.90
                        elif min_rel >= 0.65: chance = 0.20
                    elif category == "work":
                        if min_rel >= 0.85: chance = 1.0
                        elif min_rel >= 0.65: chance = 0.90
                        elif min_rel >= 0.45: chance = 0.40
                        elif min_rel >= 0.25: chance = 0.05
                    elif category == "shop":
                        if min_rel >= 0.85: chance = 1.0
                        elif min_rel >= 0.65: chance = 0.95
                        elif min_rel >= 0.45: chance = 0.60
                        elif min_rel >= 0.25: chance = 0.05
                    elif category == "eat":
                        if min_rel >= 0.85: chance = 1.0
                        elif min_rel >= 0.65: chance = 0.95
                        elif min_rel >= 0.45: chance = 0.70
                        elif min_rel >= 0.25: chance = 0.20
                    elif category == "socialize":
                        chance = 1.0
                        
                    if random.random() > chance:
                        continue
                        
                    # Start social pair
                    left["social_pair"] = {"partner_id": right["id"], "progress": 0.0, "start_tick": self._tick_count, "category": category}
                    right["social_pair"] = {"partner_id": left["id"], "progress": 0.0, "start_tick": self._tick_count, "category": category}
                    
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
                    
                left_rel = left.get("relationships", {}).get(str(right["id"]), 0.3)
                right_rel = right.get("relationships", {}).get(str(left["id"]), 0.3)
                
                # Not enemies or hate
                if left_rel > 0.25 and right_rel > 0.25:
                    left["social_pair"] = {"partner_id": right["id"], "progress": 0.0, "start_tick": self._tick_count}
                    right["social_pair"] = {"partner_id": left["id"], "progress": 0.0, "start_tick": self._tick_count}
                    left["activity"] = "socializing"
                    right["activity"] = "socializing"
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
        needs = npc["needs"]
        if all(value < 0.2 for value in needs.values()):
            return "idle"
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
                elif loc_id == home_loc_id:
                    if not extroverted:
                        activity_match += 1.5
            elif activity == "work":
                dur = WORK_DURATIONS.get(loc_type, 4.0)
                if not extroverted:
                    activity_match += dur * 0.15
                else:
                    activity_match += (8.0 - dur) * 0.15

            env = loc.get("environment", {})
            preference_match = sum(preferences.get(key, 0.0) * env.get(key, 0.0) for key in ("quiet", "crowded"))
            
            relationship_bonus = 0.0
            has_enemy = False
            for oid in loc.get("occupant_ids", []):
                rel = relationships.get(str(oid), 0.3)
                if rel <= 0.1:  # Kẻ thù
                    has_enemy = True
                    break
                elif rel >= 0.65:  # Bạn thân or Người yêu
                    relationship_bonus += 2.0
                elif rel > 0.3:
                    relationship_bonus += (rel - 0.3)
                elif rel < 0.3:
                    relationship_bonus -= (0.3 - rel)
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
        if activity == "idle":
            return npc["current_location"]
        if activity == "wander":
            candidates = [
                loc_id for loc_id, loc in self._locations.items() if loc.get("occupants", 0) < loc.get("capacity", 1)
            ]
            return random.choice(candidates) if candidates else npc["current_location"]

        # For sleep, strongly prefer going home directly
        if activity == "sleep":
            home_id = npc.get("home_location")
            enemy_at_home = False
            if home_id is not None:
                for other in self._npcs.values():
                    if other["id"] == npc["id"]:
                        continue
                    if other.get("home_location") == home_id or other.get("current_location") == home_id:
                        if npc.get("relationships", {}).get(str(other["id"]), 0.3) <= 0.1:
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
                        if npc.get("relationships", {}).get(str(other["id"]), 0.3) >= 0.85:
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
                                rel = npc.get("relationships", {}).get(str(other["id"]), 0.3)
                                if rel <= 0.25:
                                    has_hated = True
                                    break
                                elif rel >= 0.85:
                                    has_lover = True
                                    
                        if has_lover and not has_hated:
                            best_lover_home = loc_id
                            break
                            
                    if best_lover_home is not None:
                        other_residents = sum(1 for other in self._npcs.values() if other["id"] != npc["id"] and other.get("home_location") == home_id)
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
                        
                valid_homes = []
                abandoned_homes = []
                
                for loc_id, loc in self._locations.items():
                    if loc.get("type") != "house":
                        continue
                        
                    residents = residents_by_house.get(loc_id, 0)
                    if residents >= loc.get("capacity", 1):
                        continue
                        
                    if residents == 0:
                        abandoned_homes.append(loc_id)
                        
                    has_enemy = False
                    has_close_friend = False
                    for other in self._npcs.values():
                        if other["id"] == npc["id"]:
                            continue
                        if other.get("home_location") == loc_id or other.get("current_location") == loc_id:
                            rel = npc.get("relationships", {}).get(str(other["id"]), 0.3)
                            if rel <= 0.1:
                                has_enemy = True
                                break
                            elif rel >= 0.65:
                                has_close_friend = True
                                
                    if not has_enemy and has_close_friend:
                        valid_homes.append(loc_id)
                        
                if valid_homes:
                    new_home_id = random.choice(valid_homes)
                    npc["home_location"] = new_home_id
                    return new_home_id
                elif abandoned_homes and npc.get("money", 0.0) >= 50.0:
                    new_home_id = random.choice(abandoned_homes)
                    npc["money"] -= 50.0
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
        mapping = ACTIVITY_NEED_REDUCTION.get(activity)
        if mapping is None:
            return
        need_key, reduction = mapping
        needs = npc["needs"]
        
        loc = self._locations.get(npc.get("current_location", -1), {})
        loc_type = loc.get("type")

        if activity == "eat":
            price = FOOD_PRICES.get(loc_type, 0.0)
            npc["money"] = max(0.0, npc.get("money", 0.0) - price * world_hours_delta)
            if price == 0.0:
                reduction *= 0.5
            else:
                reduction *= 1.5
        elif activity == "work":
            wage = WORK_WAGES.get(loc_type, 0.0)
            npc["money"] = npc.get("money", 0.0) + wage * world_hours_delta

        if need_key in needs:
            needs[need_key] = max(0.0, min(1.0, needs[need_key] + reduction * world_hours_delta))

    def _init_npcs_from_spawns(self, map_data: dict):
        seed = map_data.get("seed", self._config.get("seed"))
        self._npcs = build_npcs_from_spawns(map_data, seed=seed, core_api=self._core_api)
        for npc in self._npcs.values():
            self._normalize_loaded_npc(npc)

    def _build_location_index(self, map_data: dict):
        self._locations, self._pathfinder = build_location_index(map_data)
        self._street_router = build_street_router(map_data)
