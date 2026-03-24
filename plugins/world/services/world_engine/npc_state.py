import hashlib
import random

from .constants import ZODIAC_SIGNS

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


def build_npcs_from_spawns(map_data, seed=None, core_api=None):
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

    for spawn in map_data.get("npcSpawns", []):
        npc_id = spawn["npc"]

        # Assign a real character if the pool has one, otherwise fall back.
        if npc_id < len(character_pool):
            char = character_pool[npc_id]
            npc_name = char.get("name", f"NPC_{npc_id}")
            npc_hash = char.get("hash")
        else:
            npc_name = f"NPC_{npc_id}"
            npc_hash = None

        # Zodiac & Birthday assignment
        # Use first character of name hash or id to deterministically but pseudo-randomly pick zodiac
        name_hash = int(hashlib.md5(npc_name.encode('utf-8')).hexdigest(), 16)
        zodiac_index = name_hash % 12
        zodiac = ZODIAC_SIGNS[zodiac_index]
        
        # Randomize birthday within the zodiac's date range
        start_m, start_d = zodiac["start"]
        end_m, end_d = zodiac["end"]
        # Simplified day picking since it's just visual flavor
        birth_month = start_m if rng.random() < 0.5 else end_m
        if birth_month == start_m:
            birth_day = rng.randint(start_d, 31 if start_m in (1, 3, 5, 7, 8, 10, 12) else 30)
            if start_m == 2: birth_day = min(birth_day, 29)
        else:
            birth_day = rng.randint(1, end_d)
            
        initial_money = rng.uniform(50.0, 200.0)
        npc = {
            "id": npc_id,
            "name": npc_name,
            "current_location": spawn["location"],
            "activity": "idle",
            "home_location": spawn["location"],
            "money": initial_money,
            "financial_plan": {
                "target_balance": rng.uniform(150.0, 400.0),
                "last_daily_balance": initial_money,
                "prioritize_work": False,
                "extroverted_finance": rng.uniform(0.0, 1.0) > 0.5,
            },
            "needs": {
                "hunger": rng.uniform(0.1, 0.5),
                "social": rng.uniform(0.1, 0.5),
                "rest": rng.uniform(0.1, 0.5),
                "work": 0.0,
            },
            "preferences": {
                "quiet": rng.uniform(0.2, 0.8),
                "crowded": rng.uniform(0.2, 0.8),
            },
            "relationships": {},  # Will be populated playfully later or lazily evaluated
            "zodiac_index": zodiac_index,
            "birthday": f"{birth_day}/{birth_month}",
            "social_pair": None,
            "energy": rng.uniform(0.5, 1.0),
            "movement": {
                "active": False,
                "mode": "idle",
                "origin_location": spawn["location"],
                "target_location": spawn["location"],
                "route_points": [],
                "distance_px": 0.0,
                "progress_px": 0.0,
                "speed_px_per_sec": 0.0,
                "render_position": None,
            },
            "last_location_interaction_tick": -10**9,
            "last_road_interaction_tick": -10**9,
        }
        if npc_hash is not None:
            npc["character_hash"] = npc_hash
        npcs[npc_id] = npc

    return npcs
