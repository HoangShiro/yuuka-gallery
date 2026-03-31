"""
NPC State Initialization - Creates NPCs with full social dynamics schemas.

Includes personality (Big Five), mood, memory, multi-dimensional relationships,
and all new social dynamics features.
"""

import hashlib
import random
from typing import Dict, List, Optional

from .constants import ZODIAC_SIGNS
from .constants_social import (
    DEFAULT_RELATIONSHIP,
    PERSONALITY_TRAITS,
    DERIVED_TRAIT_FORMULAS,
    NEW_NEEDS,
    NEED_PERSONALITY_MODIFIERS,
)


def _build_character_pool(core_api, rng):
    """Build a prioritized character pool from the character-list plugin data.

    Returns a list of ``{"name": str, "hash": str}`` dicts.  Favourited
    characters appear first (shuffled among themselves), followed by the
    remaining characters (also shuffled).  If the character-list plugin
    is unavailable or returns no data the pool will be empty.
    """
    try:
        all_characters = list(core_api.get_all_characters_list() or [])
    except Exception:
        return []

    if not all_characters:
        return []

    # Try to load every user's favourite lists so we can prioritise those
    # characters.  The lists are stored per-user in ``core_lists.json``
    # (obfuscated) where each entry looks like
    # ``{"favourites": [...], "blacklist": [...]}``.
    favourite_hashes: set[str] = set()
    blacklisted_hashes: set[str] = set()
    try:
        all_lists = core_api.data_manager.read_json(
            "core_lists.json", default_value={}, obfuscated=True,
        )
        if isinstance(all_lists, dict):
            for _user_hash, user_lists in all_lists.items():
                if isinstance(user_lists, dict):
                    for fav_hash in user_lists.get("favourites", []):
                        if isinstance(fav_hash, str):
                            favourite_hashes.add(fav_hash)
                    for bl_hash in user_lists.get("blacklist", []):
                        if isinstance(bl_hash, str):
                            blacklisted_hashes.add(bl_hash)
    except Exception:
        pass

    valid_characters = [ch for ch in all_characters if ch.get("hash") not in blacklisted_hashes]

    favourites = [ch for ch in valid_characters if ch.get("hash") in favourite_hashes]
    others = [ch for ch in valid_characters if ch.get("hash") not in favourite_hashes]
    rng.shuffle(favourites)
    rng.shuffle(others)

    return favourites + others


def generate_personality(rng: random.Random, personality_profile: Optional[dict] = None) -> dict:
    """
    Generate a personality for an NPC based on Big Five traits.
    
    Args:
        rng: Random number generator
        personality_profile: Optional profile with social/calm/nature values
    
    Returns:
        Personality dict with Big Five and derived traits
    """
    # Generate Big Five traits
    if personality_profile:
        # Map from old profile to Big Five
        social = personality_profile.get("social", 0.5)
        calm = personality_profile.get("calm", 0.5)
        nature = personality_profile.get("nature", 0.5)
        
        # Extraversion from social
        extraversion = social
        
        # Agreeableness from calm (calm people tend to be more agreeable)
        agreeableness = 0.3 + calm * 0.5
        
        # Neuroticism inverse of calm
        neuroticism = 1.0 - calm
        
        # Conscientiousness from nature (nature lovers tend to be more conscientious)
        conscientiousness = 0.3 + nature * 0.4
        
        # Openness from nature and social
        openness = 0.3 + nature * 0.3 + social * 0.2
        
        # Add some randomness
        extraversion = clamp(rng.gauss(extraversion, 0.1), 0.0, 1.0)
        agreeableness = clamp(rng.gauss(agreeableness, 0.1), 0.0, 1.0)
        neuroticism = clamp(rng.gauss(neuroticism, 0.1), 0.0, 1.0)
        conscientiousness = clamp(rng.gauss(conscientiousness, 0.1), 0.0, 1.0)
        openness = clamp(rng.gauss(openness, 0.1), 0.0, 1.0)
    else:
        # Random generation with slight tendency toward middle values
        extraversion = clamp(rng.gauss(0.5, 0.2), 0.0, 1.0)
        agreeableness = clamp(rng.gauss(0.5, 0.2), 0.0, 1.0)
        neuroticism = clamp(rng.gauss(0.5, 0.2), 0.0, 1.0)
        conscientiousness = clamp(rng.gauss(0.5, 0.2), 0.0, 1.0)
        openness = clamp(rng.gauss(0.5, 0.2), 0.0, 1.0)
    
    personality = {
        "extraversion": extraversion,
        "agreeableness": agreeableness,
        "neuroticism": neuroticism,
        "conscientiousness": conscientiousness,
        "openness": openness,
    }
    
    # Calculate derived traits
    for trait_name, formula in DERIVED_TRAIT_FORMULAS.items():
        try:
            personality[trait_name] = clamp(formula(personality), 0.0, 1.0)
        except (KeyError, TypeError):
            personality[trait_name] = 0.5
    
    return personality


def generate_initial_mood(personality: dict, rng: random.Random) -> dict:
    """
    Generate initial mood based on personality.
    
    Args:
        personality: The NPC's personality
        rng: Random number generator
    
    Returns:
        Initial mood dict
    """
    neuroticism = personality.get("neuroticism", 0.5)
    extraversion = personality.get("extraversion", 0.5)
    
    # Determine base mood
    if neuroticism > 0.7 and rng.random() < 0.3:
        base_mood = "anxious"
        intensity = 0.3 + neuroticism * 0.3
    elif extraversion > 0.7 and rng.random() < 0.3:
        base_mood = "content"
        intensity = 0.4 + extraversion * 0.2
    else:
        base_mood = "neutral"
        intensity = 0.5
    
    return {
        "current": base_mood,
        "intensity": clamp(intensity, 0.0, 1.0),
        "cause": "initialization",
        "duration_ticks": 0,
        "modifiers": {},
    }


def generate_initial_needs(rng: random.Random, personality: dict) -> dict:
    """
    Generate initial needs including new needs.
    
    Args:
        rng: Random number generator
        personality: The NPC's personality
    
    Returns:
        Needs dict
    """
    needs = {
        "hunger": rng.uniform(0.1, 0.5),
        "social": rng.uniform(0.1, 0.5),
        "rest": rng.uniform(0.1, 0.5),
        "work": 0.0,
        # New needs
        "entertainment": rng.uniform(0.1, 0.4),
        "intimacy": rng.uniform(0.05, 0.3),
        "autonomy": rng.uniform(0.05, 0.2),
    }
    
    # Adjust based on personality
    extraversion = personality.get("extraversion", 0.5)
    neuroticism = personality.get("neuroticism", 0.5)
    
    # Introverts have lower social need
    needs["social"] *= (0.5 + extraversion * 0.5)
    
    # Neurotic NPCs have higher intimacy need
    needs["intimacy"] *= (0.7 + neuroticism * 0.3)
    
    return needs


def generate_initial_preferences(rng: random.Random, personality: dict) -> dict:
    """
    Generate initial location preferences based on personality.
    
    Args:
        rng: Random number generator
        personality: The NPC's personality
    
    Returns:
        Preferences dict
    """
    extraversion = personality.get("extraversion", 0.5)
    openness = personality.get("openness", 0.5)
    
    return {
        "quiet": clamp(rng.uniform(0.2, 0.8) * (1.5 - extraversion), 0.0, 1.0),
        "crowded": clamp(rng.uniform(0.2, 0.8) * extraversion, 0.0, 1.0),
        "nature": clamp(rng.uniform(0.2, 0.8) * openness, 0.0, 1.0),
        "urban": clamp(rng.uniform(0.2, 0.8) * (1.5 - openness), 0.0, 1.0),
    }


def clamp(value: float, min_val: float, max_val: float) -> float:
    """Clamp a value to a range."""
    return max(min_val, min(max_val, value))


def _pick_character_for_npc(
    npc_id: int,
    character_pool: list[dict],
    used_character_hashes: Optional[set[str]] = None,
) -> tuple[str, Optional[str]]:
    if used_character_hashes is None:
        used_character_hashes = set()

    chosen = None
    for char in character_pool:
        char_hash = char.get("hash")
        if char_hash and char_hash in used_character_hashes:
            continue
        chosen = char
        break

    if chosen is None:
        return f"NPC_{npc_id}", None

    return chosen.get("name", f"NPC_{npc_id}"), chosen.get("hash")


def build_single_npc(
    npc_id: int,
    spawn_location: int,
    rng: random.Random,
    core_api=None,
    personality_profile: Optional[dict] = None,
    character_pool: Optional[list[dict]] = None,
    used_character_hashes: Optional[set[str]] = None,
) -> dict:
    if character_pool is None:
        character_pool = _build_character_pool(core_api, rng) if core_api is not None else []

    npc_name, npc_hash = _pick_character_for_npc(
        npc_id,
        character_pool,
        used_character_hashes=used_character_hashes,
    )

    name_hash = int(hashlib.md5(npc_name.encode("utf-8")).hexdigest(), 16)
    zodiac_index = name_hash % 12
    zodiac = ZODIAC_SIGNS[zodiac_index]

    start_m, start_d = zodiac["start"]
    end_m, end_d = zodiac["end"]
    birth_month = start_m if rng.random() < 0.5 else end_m
    if birth_month == start_m:
        birth_day = rng.randint(start_d, 31 if start_m in (1, 3, 5, 7, 8, 10, 12) else 30)
        if start_m == 2:
            birth_day = min(birth_day, 29)
    else:
        birth_day = rng.randint(1, end_d)

    personality = generate_personality(rng, personality_profile)
    mood = generate_initial_mood(personality, rng)
    needs = generate_initial_needs(rng, personality)
    preferences = generate_initial_preferences(rng, personality)
    initial_money = rng.uniform(50.0, 200.0)

    npc = {
        "id": npc_id,
        "name": npc_name,
        "current_location": spawn_location,
        "activity": "idle",
        "home_location": spawn_location,
        "moved_in_tick": 0,
        "money": initial_money,
        "financial_plan": {
            "target_balance": rng.uniform(150.0, 400.0),
            "last_daily_balance": initial_money,
            "prioritize_work": False,
            "extroverted_finance": personality.get("extraversion", 0.5) > 0.5,
        },
        "needs": needs,
        "preferences": preferences,
        "personality": personality,
        "mood": mood,
        "memories": [],
        "relationships": {},
        "zodiac_index": zodiac_index,
        "birthday": f"{birth_day}/{birth_month}",
        "social_pair": None,
        "energy": rng.uniform(0.5, 1.0),
        "reputation": 0.5,
        "movement": {
            "active": False,
            "mode": "idle",
            "origin_location": spawn_location,
            "target_location": spawn_location,
            "route_points": [],
            "distance_px": 0.0,
            "progress_px": 0.0,
            "speed_px_per_sec": 0.0,
            "render_position": None,
        },
        "last_location_interaction_tick": -10**9,
        "last_road_interaction_tick": -10**9,
        "dating_since_tick": None,
        "partner_id": None,
        "job_location": None,
        "job_type": None,
        "job_assigned_tick": None,
        "job_change_cooldown_tick": 0,
        "job_change_reason": None,
        "birth_event_id": None,
        "assigned_construction_site": None,
        "family_links": {
            "parents": [],
            "children": [],
            "siblings": [],
        },
    }

    if npc_hash is not None:
        npc["character_hash"] = npc_hash

    return npc


def build_npcs_from_spawns(map_data, seed=None, core_api=None, personality_profile=None, assign_home: bool = True) -> Dict[int, dict]:
    """
    Build NPCs from spawn points with full social dynamics schemas.
    
    Args:
        map_data: World map data with npcSpawns
        seed: Random seed for reproducibility
        core_api: Core API for character pool
        personality_profile: Optional default personality profile
    
    Returns:
        Dict of NPC ID -> NPC data
    """
    if seed is None:
        seed = map_data.get("seed", 0)
    rng = random.Random(seed)

    # Build a pool of real characters when possible.
    character_pool: list[dict] = []
    if core_api is not None:
        try:
            character_pool = _build_character_pool(core_api, rng)
        except Exception:
            character_pool = []

    npcs = {}
    used_character_hashes: set[str] = set()

    for spawn in map_data.get("npcSpawns", []):
        npc_id = spawn["npc"]
        npc = build_single_npc(
            npc_id,
            spawn["location"],
            rng,
            core_api=core_api,
            personality_profile=personality_profile,
            character_pool=character_pool,
            used_character_hashes=used_character_hashes,
        )
        if not assign_home:
            npc["home_location"] = None
        npc_hash = npc.get("character_hash")
        if npc_hash:
            used_character_hashes.add(npc_hash)
        npcs[npc_id] = npc

    return npcs


def migrate_npc_to_new_schema(npc: dict, rng: Optional[random.Random] = None) -> dict:
    """
    Migrate an existing NPC to the new schema.
    
    Args:
        npc: Existing NPC data
        rng: Optional random number generator
    
    Returns:
        Migrated NPC data
    """
    if rng is None:
        rng = random.Random()
    
    # Generate personality if missing
    if "personality" not in npc:
        # Try to derive from existing fields
        extroverted = npc.get("financial_plan", {}).get("extroverted_finance", False)
        personality = generate_personality(rng, {
            "social": 0.7 if extroverted else 0.3,
            "calm": 0.5,
            "nature": 0.5,
        })
        npc["personality"] = personality
    else:
        # Ensure derived traits exist
        personality = npc["personality"]
        for trait_name, formula in DERIVED_TRAIT_FORMULAS.items():
            if trait_name not in personality:
                try:
                    personality[trait_name] = clamp(formula(personality), 0.0, 1.0)
                except (KeyError, TypeError):
                    personality[trait_name] = 0.5
    
    # Generate mood if missing
    if "mood" not in npc:
        npc["mood"] = generate_initial_mood(npc.get("personality", {}), rng)
    
    # Initialize memories if missing
    if "memories" not in npc:
        npc["memories"] = []
    
    # Migrate relationships to new format
    relationships = npc.get("relationships", {})
    migrated_relationships = {}
    
    for other_id_str, value in relationships.items():
        if isinstance(value, (int, float)):
            # Old format: single value
            migrated_relationships[other_id_str] = {
                "trust": float(value) - 0.3, # 0.3 is neutral -> 0.0
                "respect": (float(value) - 0.3) * 0.8,
                "attraction": float(value) * 0.5,
                "familiarity": float(value),
                "type": _infer_relationship_type(float(value)),
                "history": [],
                "last_interaction_tick": npc.get("last_location_interaction_tick", -10**9),
                "interaction_count": 1,
                "positive_interactions": 1 if value > 0.5 else 0,
                "negative_interactions": 1 if value < 0.2 else 0,
            }
        elif isinstance(value, dict):
            # Already new format, ensure all fields exist
            migrated = DEFAULT_RELATIONSHIP.copy()
            migrated.update(value)
            migrated_relationships[other_id_str] = migrated
    
    npc["relationships"] = migrated_relationships
    
    # Add new needs if missing
    needs = npc.get("needs", {})
    for need_name, need_config in NEW_NEEDS.items():
        if need_name not in needs:
            needs[need_name] = rng.uniform(0.05, 0.3)
    npc["needs"] = needs
    
    # Add moved_in_tick if missing
    if "moved_in_tick" not in npc:
        npc["moved_in_tick"] = 0
    
    # Add reputation if missing
    if "reputation" not in npc:
        npc["reputation"] = 0.5
    
    # Add dating tracking if missing
    if "dating_since_tick" not in npc:
        npc["dating_since_tick"] = None
    if "partner_id" not in npc:
        npc["partner_id"] = None

    # Add employment tracking if missing
    if "job_location" not in npc:
        npc["job_location"] = None
    if "job_type" not in npc:
        npc["job_type"] = None
    if "job_assigned_tick" not in npc:
        npc["job_assigned_tick"] = None
    if "job_change_cooldown_tick" not in npc:
        npc["job_change_cooldown_tick"] = 0
    if "job_change_reason" not in npc:
        npc["job_change_reason"] = None
    if "birth_event_id" not in npc:
        npc["birth_event_id"] = None
    if "assigned_construction_site" not in npc:
        npc["assigned_construction_site"] = None
    family_links = npc.get("family_links")
    if not isinstance(family_links, dict):
        family_links = {}
    for key in ("parents", "children", "siblings"):
        value = family_links.get(key)
        if isinstance(value, list):
            family_links[key] = [int(item) for item in value if isinstance(item, (int, float, str)) and str(item).isdigit()]
        else:
            family_links[key] = []
    npc["family_links"] = family_links
    
    return npc


def _infer_relationship_type(value: float) -> str:
    """Infer relationship type from old single value (0.0 to 1.0)."""
    if value < 0.15:
        return "enemy"
    elif value < 0.25:
        return "rival"
    elif value < 0.45:
        return "stranger"
    elif value < 0.65:
        return "friend"
    elif value < 0.85:
        return "close_friend"
    else:
        return "partner"
