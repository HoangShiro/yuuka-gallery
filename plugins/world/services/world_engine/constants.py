DEFAULT_CONFIG = {
    "npcCount": 50,
    "personality": "Balanced",
    "personalityProfile": {"social": 0.5, "calm": 0.5, "nature": 0.5},
    "mainRoadCount": 2.0,
    "subRoadCount": 8,
    "roadSkew": 0.0,
    "roadCurve": 0,
    "buildingDensity": "Uniform",
    "socializeMode": "None",
    "assignHome": True,
    "birthRate": 100,
    "seed": None,
    "tick_interval_ms": 250,
    "save_every_n_ticks": 10,
    "mood_curiosity_enabled": False,
}

WORLD_DAY_REAL_TIME_SECONDS = 30 * 60
WORLD_SECONDS_PER_REAL_SECOND_AT_X1 = (24 * 60 * 60) / WORLD_DAY_REAL_TIME_SECONDS
FAST_TRAVEL_THRESHOLD = 5.0
DEFAULT_SIMULATION_SPEED = 1.0
RUN_NEED_THRESHOLD = 0.8
WALK_SPEED_PX_PER_SEC = 32.0
RUN_SPEED_PX_PER_SEC = 56.0
ROAD_INTERACTION_DISTANCE_PX = 18.0
ROAD_INTERACTION_COOLDOWN_TICKS = 12
LOCATION_INTERACTION_COOLDOWN_TICKS = 24
ROAD_INTERACTION_SOCIAL_BOOST = 0.08
ROAD_INTERACTION_RELATIONSHIP_BOOST = 0.05

# ─── Activity durations (world-hours) ────────────────────────────────────────
# How many world-hours an NPC stays at a location for each activity.
# 1 world-hour = 3600 world-seconds.
ACTIVITY_DURATION_WORLD_HOURS = {
    "sleep":     8.0,
    "birth_prep": 1.0,
    "eat":       1.0,
    "socialize": 2.0,
    "relax":     1.5,
    "study":     3.0,
    "work":      4.0,
    "walk":      0.5,
    "idle":      0.5,
    "wander":    0.25,
}
DEFAULT_ACTIVITY_DURATION_WORLD_HOURS = 1.0

# ─── Currency and Work ─────────────────────────────────────────────────────
FOOD_PRICES = {
    "cafe": 15.0,
    "shop": 5.0,
    "cinema": 12.0,
    "house": 0.0,
}

WORK_WAGES = {
    "cafe": 7.0,
    "office": 12.0,
    "factory": 8.0,
    "studio": 10.0,
    "builder_hq": 11.0,
    "construction_site": 11.0,
    "shop": 6.0,
    "school": 7.0,
    "hospital": 15.0,
    "library": 8.0,
    "gym": 8.0,
    "arcade": 9.0,
    "museum": 9.0,
    "cinema": 8.0,
}

WORK_DURATIONS = {
    "cafe": 5.0,
    "office": 6.0,
    "factory": 8.0,
    "studio": 4.0,
    "builder_hq": 8.0,
    "construction_site": 8.0,
    "shop": 4.0,
    "school": 6.0,
    "hospital": 8.0,
    "library": 5.0,
    "gym": 4.0,
    "arcade": 5.0,
    "museum": 5.0,
    "cinema": 4.0,
}

JOB_CAPACITY_BY_TYPE = {
    "cafe": 4,
    "office": 12,
    "factory": 16,
    "studio": 5,
    "builder_hq": 10,
    "construction_site": 8,
    "shop": 5,
    "school": 10,
    "hospital": 12,
    "library": 6,
    "gym": 5,
    "arcade": 6,
    "museum": 7,
    "cinema": 6,
}

# ─── Need increase / decrease rates ─────────────────────────────────────────
# Rates are per world-hour.  A full 0→1 cycle should roughly match a waking
# day (~16 hours), so the increase rates are tuned accordingly.
NEED_INCREASE_RATE = {
    "hunger": 1.0 / 12.0,   # full in ~12 h → eats ~2 meals per day
    "social": 1.0 / 16.0,   # full in ~16 h
    "rest":   1.0 / 32.0,   # full in ~32 base hours (approx 1.0 unit per day with multipliers)
    "work":   0.0,          # managed dynamically by financial plan
    # New needs for social dynamics
    "entertainment": 1.0 / 24.0,  # full in ~24 h
    "intimacy": 1.0 / 48.0,       # full in ~48 h
    "autonomy": 1.0 / 72.0,       # full in ~72 h
}

# ─── Time-based need multipliers ────────────────────────────────────────────
# Each need maps to a list of (start_hour, end_hour, multiplier) tuples.
# During the specified world-hour range the base increase rate is scaled by
# the multiplier, creating a natural daily rhythm.  Hours not covered by any
# range use multiplier 1.0.
#
# Hunger:  spikes around meal times (breakfast / lunch / dinner)
# Rest:    climbs steeply at night, encouraging NPCs to sleep
# Social:  elevated during daytime activity hours
TIME_BASED_NEED_MULTIPLIER = {
    "hunger": [
        (6,  8,  2.0),   # breakfast window
        (11, 13, 2.0),   # lunch window
        (17, 19, 2.0),   # dinner window
    ],
    "rest": [
        (22, 24, 4.0),   # night → very sleepy
        (0,  6,  4.0),   # night → very sleepy
        (6, 22, 0.1),    # day → barely increases
    ],
    "social": [
        (9,  17, 1.5),   # daytime  → more sociable
    ],
    "work": [
        (22, 24, 0.0),   # no work at night
        (0,  6,  0.0),   # no work at night
    ],
}

# Need reduction rate per world-hour while performing the activity.
# Tuned so the activity duration is just enough to satisfy the need from 1→0.
ACTIVITY_NEED_REDUCTION = {
    "eat":       [("hunger", -1.0 / 1.0)],    # 1 h to fully satisfy
    "sleep":     [("rest",   -1.0 / 8.0)],     # 8 h to fully satisfy
    "socialize": [("social", -1.0 / 2.0), ("intimacy", -1.0 / 4.0)], # 2 h to fully satisfy social, partial intimacy
    "relax":     [("rest",   -1.0 / 4.0), ("entertainment", -1.0 / 2.0)], # 4 h to 50% rest, 2h for full entertainment
    "study":     [("social", -1.0 / 6.0)],     # minor social benefit
    "work":      [("work",   -1.0 / 4.0)],     # 4 h to fully satisfy
    "walk":      [("rest",   -1.0 / 4.0)],     # light rest
    "wander":    [("autonomy", -1.0 / 1.0)],   # 1 h to fully satisfy autonomy
}

NEED_TO_ACTIVITY = {
    "hunger": "eat",
    "social": "socialize",
    "rest": "sleep",
    "work": "work",
    # New needs
    "entertainment": "relax",
    "intimacy": "socialize",
    "autonomy": "wander",
}

ACTIVITY_LOCATION_TYPES = {
    "eat": {"cafe", "shop", "cinema", "house"},
    "sleep": {"house"},
    "socialize": {"cafe", "park", "shop", "gym", "arcade", "cinema"},
    "relax": {"park", "shrine", "library", "gym", "arcade", "cinema", "museum"},
    "study": {"school", "library", "museum"},
    "work": {"cafe", "shop", "school", "office", "factory", "studio", "hospital", "library", "gym", "arcade", "museum", "cinema", "builder_hq", "construction_site"},
    "walk": {"park"},
}

PERSONALITY_TO_PROFILE = {
    "Balanced": {"social": 0.5, "calm": 0.5, "nature": 0.5},
    "Extroverted": {"social": 0.85, "calm": 0.3, "nature": 0.25},
    "Introverted": {"social": 0.3, "calm": 0.8, "nature": 0.7},
}

DENSITY_TO_COMPLEXITY = {
    "Scattered": 0.2,
    "Uniform": 0.5,
    "Concentrated": 0.8,
}

# ─── Affinity System ("Cảm tình") ──────────────────────────────────────────

ZODIAC_SIGNS = [
    {"name": "Aries",       "start": (3, 21),  "end": (4, 19),  "emoji": "♈"},
    {"name": "Taurus",      "start": (4, 20),  "end": (5, 20),  "emoji": "♉"},
    {"name": "Gemini",      "start": (5, 21),  "end": (6, 20),  "emoji": "♊"},
    {"name": "Cancer",      "start": (6, 21),  "end": (7, 22),  "emoji": "♋"},
    {"name": "Leo",         "start": (7, 23),  "end": (8, 22),  "emoji": "♌"},
    {"name": "Virgo",       "start": (8, 23),  "end": (9, 22),  "emoji": "♍"},
    {"name": "Libra",       "start": (9, 23),  "end": (10, 22), "emoji": "♎"},
    {"name": "Scorpio",     "start": (10, 23), "end": (11, 21), "emoji": "♏"},
    {"name": "Sagittarius", "start": (11, 22), "end": (12, 21), "emoji": "♐"},
    {"name": "Capricorn",   "start": (12, 22), "end": (1, 19),  "emoji": "♑"},
    {"name": "Aquarius",    "start": (1, 20),  "end": (2, 18),  "emoji": "♒"},
    {"name": "Pisces",      "start": (2, 19),  "end": (3, 20),  "emoji": "♓"},
]

# Zodiac compatibility matrix (0.0 to 1.0)
# A simple implementation based on elements:
# Fire: Aries (0), Leo (4), Sagittarius (8)
# Earth: Taurus (1), Virgo (5), Capricorn (9)
# Air: Gemini (2), Libra (6), Aquarius (10)
# Water: Cancer (3), Scorpio (7), Pisces (11)
def _build_zodiac_compatibility():
    elements = [
        "Fire", "Earth", "Air", "Water", "Fire", "Earth", 
        "Air", "Water", "Fire", "Earth", "Air", "Water"
    ]
    matrix = [[0.5 for _ in range(12)] for _ in range(12)]
    for i in range(12):
        for j in range(12):
            if i == j:
                matrix[i][j] = 0.9 # Same sign is highly compatible
            elif elements[i] == elements[j]:
                matrix[i][j] = 0.8 # Same element is very compatible
            elif (elements[i] == "Fire" and elements[j] == "Air") or (elements[i] == "Air" and elements[j] == "Fire"):
                matrix[i][j] = 0.7 # Complementary
            elif (elements[i] == "Earth" and elements[j] == "Water") or (elements[i] == "Water" and elements[j] == "Earth"):
                matrix[i][j] = 0.7 # Complementary
            elif (elements[i] == "Fire" and elements[j] == "Water") or (elements[i] == "Water" and elements[j] == "Fire"):
                matrix[i][j] = 0.3 # Opposites
            elif (elements[i] == "Earth" and elements[j] == "Air") or (elements[i] == "Air" and elements[j] == "Earth"):
                matrix[i][j] = 0.4 # Less compatible
    return matrix

ZODIAC_COMPATIBILITY = _build_zodiac_compatibility()

RELATIONSHIP_LEVELS = [
    {"name": "Kẻ thù",    "min": 0.0,  "max": 0.1},
    {"name": "Ghét",      "min": 0.1,  "max": 0.25},
    {"name": "Người lạ",  "min": 0.25, "max": 0.45},
    {"name": "Bạn",       "min": 0.45, "max": 0.65},
    {"name": "Bạn thân",  "min": 0.65, "max": 0.85},
    {"name": "Người yêu", "min": 0.85, "max": 1.0},
]

SOCIAL_AFFINITY_GAIN_EXTROVERTED = 0.06
SOCIAL_AFFINITY_GAIN_INTROVERTED = 0.03
SOCIAL_AFFINITY_LOSS_EXTROVERTED = 0.02
SOCIAL_AFFINITY_LOSS_INTROVERTED = 0.04
