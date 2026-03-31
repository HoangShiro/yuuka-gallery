import copy

from .constants import DEFAULT_CONFIG, PERSONALITY_TO_PROFILE


VALID_PERSONALITIES = {"Balanced", "Introverted", "Extroverted"}
VALID_DENSITIES = {"Scattered", "Uniform", "Concentrated"}
VALID_SOCIALIZE_MODES = {"None", "Half", "Full"}


def _clamp_int(value, default, lo, hi):
    try:
        return max(lo, min(hi, int(value)))
    except (TypeError, ValueError):
        return default


def _clamp_float(value, default, lo, hi):
    try:
        return max(lo, min(hi, float(value)))
    except (TypeError, ValueError):
        return default


def _normalize_personality_string(value):
    if not isinstance(value, str):
        return None
    normalized = value.strip().capitalize()
    if normalized in VALID_PERSONALITIES:
        return normalized
    legacy = value.strip().lower()
    if legacy == "social":
        return "Extroverted"
    if legacy in {"calm", "nature"}:
        return "Introverted"
    return None


def _normalize_profile(value):
    if not isinstance(value, dict):
        return None
    profile = {
        "social": _clamp_float(value.get("social", 0.5), 0.5, 0.0, 1.0),
        "calm": _clamp_float(value.get("calm", 0.5), 0.5, 0.0, 1.0),
        "nature": _clamp_float(value.get("nature", 0.5), 0.5, 0.0, 1.0),
    }
    return profile


def profile_to_personality(profile):
    social = profile["social"]
    calm = profile["calm"]
    nature = profile["nature"]
    if social >= calm + 0.12 and social >= nature + 0.12:
        return "Extroverted"
    if calm >= social + 0.12 or nature >= social + 0.18:
        return "Introverted"
    return "Balanced"


def normalize_personality(raw_config, base_config):
    profile = _normalize_profile(raw_config.get("personalityProfile"))
    personality = _normalize_personality_string(raw_config.get("personality"))

    if profile is None and isinstance(raw_config.get("personality"), dict):
        profile = _normalize_profile(raw_config.get("personality"))

    if personality is None and profile is not None:
        personality = profile_to_personality(profile)

    if personality is None:
        personality = base_config["personality"]

    if profile is None:
        profile = copy.deepcopy(PERSONALITY_TO_PROFILE[personality])

    return personality, profile


def normalize_building_density(raw_config, base_density):
    value = raw_config.get("buildingDensity")
    if isinstance(value, str):
        normalized = value.strip().capitalize()
        legacy_map = {
            "Sparse": "Scattered",
            "Even": "Uniform",
            "Clustered": "Concentrated",
            "Scattered": "Scattered",
            "Uniform": "Uniform",
            "Concentrated": "Concentrated",
        }
        if normalized in legacy_map:
            return legacy_map[normalized]

    if "blockComplexity" in raw_config and raw_config["blockComplexity"] is not None:
        complexity = _clamp_float(raw_config["blockComplexity"], 0.5, 0.0, 1.0)
        if complexity < 0.34:
            return "Scattered"
        if complexity > 0.66:
            return "Concentrated"
        return "Uniform"

    return base_density


def normalize_socialize_mode(raw_config, base_mode):
    value = raw_config.get("socializeMode", base_mode)
    if isinstance(value, str):
        normalized = value.strip().capitalize()
        if normalized in VALID_SOCIALIZE_MODES:
            return normalized
    return base_mode


def normalize_engine_config(raw_config, base_config=None):
    if base_config is None:
        base = copy.deepcopy(DEFAULT_CONFIG)
    else:
        base = copy.deepcopy(base_config)

    if raw_config is None:
        raw = {}
    elif isinstance(raw_config, dict):
        raw = dict(raw_config)
    else:
        raise TypeError("config must be a dict")

    merged = copy.deepcopy(base)
    for key, value in raw.items():
        if key not in {"npcCount", "personality", "personalityProfile", "mainRoadCount", "arterialCount",
                       "subRoadCount", "roadSkew", "roadCurve", "buildingDensity", "blockComplexity",
                       "socializeMode", "assignHome", "birthRate"}:
            merged[key] = value

    merged["npcCount"] = _clamp_int(raw.get("npcCount", base["npcCount"]), base["npcCount"], 1, 500)
    merged["mainRoadCount"] = _clamp_float(
        raw.get("mainRoadCount", raw.get("arterialCount", base["mainRoadCount"])),
        base["mainRoadCount"],
        1.0,
        5.0,
    )
    merged["subRoadCount"] = _clamp_int(raw.get("subRoadCount", base["subRoadCount"]), base["subRoadCount"], 0, 50)
    merged["roadSkew"] = _clamp_float(raw.get("roadSkew", base["roadSkew"]), base["roadSkew"], 0.0, 1.0)
    merged["roadCurve"] = _clamp_int(raw.get("roadCurve", base["roadCurve"]), base["roadCurve"], 0, 5)
    merged["buildingDensity"] = normalize_building_density(raw, base["buildingDensity"])
    merged["socializeMode"] = normalize_socialize_mode(raw, base.get("socializeMode", "None"))
    merged["assignHome"] = bool(raw.get("assignHome", base.get("assignHome", True)))
    merged["birthRate"] = _clamp_int(raw.get("birthRate", base.get("birthRate", 100)), base.get("birthRate", 100), 0, 100)
    merged["personality"], merged["personalityProfile"] = normalize_personality(raw, base)

    if "tick_interval_ms" in raw:
        merged["tick_interval_ms"] = _clamp_int(raw["tick_interval_ms"], base["tick_interval_ms"], 100, 60000)
    if "save_every_n_ticks" in raw:
        merged["save_every_n_ticks"] = max(1, _clamp_int(raw["save_every_n_ticks"], base["save_every_n_ticks"], 1, 10**9))

    if "seed" in raw:
        try:
            merged["seed"] = None if raw["seed"] is None else int(raw["seed"])
        except (TypeError, ValueError):
            merged["seed"] = base.get("seed")

    return merged


def export_config_view(config):
    view = {
        "npcCount": config["npcCount"],
        "personality": config["personality"],
        "mainRoadCount": config["mainRoadCount"],
        "subRoadCount": config["subRoadCount"],
        "roadSkew": config["roadSkew"],
        "roadCurve": config["roadCurve"],
        "buildingDensity": config["buildingDensity"],
        "socializeMode": config.get("socializeMode", "None"),
        "assignHome": bool(config.get("assignHome", True)),
        "birthRate": config.get("birthRate", 100),
        "seed": config.get("seed"),
        "tick_interval_ms": config["tick_interval_ms"],
        "save_every_n_ticks": config["save_every_n_ticks"],
        "mood_curiosity_enabled": config["mood_curiosity_enabled"],
    }
    return view
