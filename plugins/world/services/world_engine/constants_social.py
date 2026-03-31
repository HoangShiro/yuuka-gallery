# Social Dynamics Constants
# Multi-dimensional relationships, memory, mood, and personality systems

# ─── Relationship Types & Stages ─────────────────────────────────────────────

RELATIONSHIP_TYPES = [
    "stranger",
    "acquaintance", 
    "friend",
    "close_friend",
    "crush",
    "dating",
    "partner",
    "ex",
    "rival",
    "enemy",
]

# Requirements for each relationship type
# Format: {type: {dimension: min_value, ...}}
RELATIONSHIP_TYPE_REQUIREMENTS = {
    "stranger": {},
    "acquaintance": {"familiarity": 0.10},
    "friend": {"familiarity": 0.25, "trust": 0.10},
    "close_friend": {"familiarity": 0.50, "trust": 0.30, "respect": 0.20},
    "crush": {"attraction": 0.30, "familiarity": 0.20},
    "dating": {"attraction": 0.45, "trust": 0.40, "familiarity": 0.45},
    "partner": {"attraction": 0.55, "trust": 0.65, "familiarity": 0.60, "respect": 0.40},
    "ex": {},  # Assigned after breakup
    "rival": {"trust": -0.20},  # Negative trust threshold
    "enemy": {"trust": -0.40, "respect": -0.20},
}

# Relationship dimension bounds
RELATIONSHIP_DIMENSION_BOUNDS = {
    "trust": (-1.0, 1.0),
    "respect": (-1.0, 1.0),
    "attraction": (0.0, 1.0),
    "familiarity": (0.0, 1.0),
}

# Default values for new relationships
DEFAULT_RELATIONSHIP = {
    "trust": 0.0,
    "respect": 0.0,
    "attraction": 0.0,
    "familiarity": 0.0,
    "type": "stranger",
    "history": [],
    "last_interaction_tick": -10**9,
    "interaction_count": 0,
    "positive_interactions": 0,
    "negative_interactions": 0,
}

# Relationship change rates
RELATIONSHIP_CHANGE_RATES = {
    # Base change per interaction type
    "positive_interaction": {
        "trust": 0.03,
        "respect": 0.02,
        "familiarity": 0.05,
        "attraction": 0.01,
    },
    "negative_interaction": {
        "trust": -0.08,
        "respect": -0.05,
        "familiarity": 0.02,  # Still get to know them
        "attraction": -0.03,
    },
    "deep_conversation": {
        "trust": 0.06,
        "familiarity": 0.08,
        "attraction": 0.02,
    },
    "conflict": {
        "trust": -0.15,
        "respect": -0.10,
        "attraction": -0.05,
    },
    "betrayal": {
        "trust": -0.40,
        "respect": -0.30,
        "attraction": -0.20,
    },
    "reconciliation": {
        "trust": 0.10,
        "respect": 0.05,
    },
    "shared_experience": {
        "familiarity": 0.10,
        "trust": 0.02,
    },
    "romantic_interaction": {
        "attraction": 0.08,
        "trust": 0.03,
        "familiarity": 0.04,
    },
    "breakup": {
        "trust": -0.20,
        "attraction": -0.30,
    },
}

# Natural decay/growth over time (per world-hour)
RELATIONSHIP_NATURAL_DECAY = {
    "trust": 0.001,      # Trust slowly decays without contact
    "respect": 0.0005,
    "attraction": 0.002,  # Attraction fades faster
    "familiarity": 0.0002,  # Familiarity very stable
}

# ─── Memory System ──────────────────────────────────────────────────────────

MEMORY_TYPES = [
    "interaction",      # Normal social interaction
    "deep_conversation", # Meaningful conversation
    "conflict",         # Argument or fight
    "reconciliation",   # Making up after conflict
    "betrayal",         # Major trust violation
    "romantic",         # Romantic moment
    "breakup",          # Relationship ended
    "shared_experience", # Did something together
    "achievement",      # Personal accomplishment
    "trauma",           # Highly negative event
    "gossip_heard",     # Heard a rumor
    "gossip_spread",    # Spread a rumor
]

# Memory importance multipliers by type
MEMORY_IMPORTANCE_BASE = {
    "interaction": 0.3,
    "deep_conversation": 0.6,
    "conflict": 0.7,
    "reconciliation": 0.5,
    "betrayal": 0.95,
    "romantic": 0.7,
    "breakup": 0.9,
    "shared_experience": 0.5,
    "achievement": 0.6,
    "trauma": 0.95,
    "gossip_heard": 0.25,
    "gossip_spread": 0.20,
}

# Memory decay rates (importance multiplier per world-hour)
MEMORY_DECAY_RATE = {
    "interaction": 0.02,
    "deep_conversation": 0.01,
    "conflict": 0.008,
    "reconciliation": 0.012,
    "betrayal": 0.003,      # Betrayal memories last very long
    "romantic": 0.008,
    "breakup": 0.005,
    "shared_experience": 0.015,
    "achievement": 0.01,
    "trauma": 0.002,        # Trauma lasts longest
    "gossip_heard": 0.03,
    "gossip_spread": 0.025,
}

# Minimum importance threshold - memories below this are forgotten
MEMORY_FORGET_THRESHOLD = 0.05

# Maximum memories per NPC (oldest/least important forgotten first)
MAX_MEMORIES_PER_NPC = 100

# Memory emotional impact templates
MEMORY_EMOTIONAL_IMPACT = {
    "interaction": {"trust": 0.02, "familiarity": 0.03},
    "deep_conversation": {"trust": 0.05, "familiarity": 0.06, "attraction": 0.02},
    "conflict": {"trust": -0.10, "respect": -0.05},
    "reconciliation": {"trust": 0.08, "respect": 0.03},
    "betrayal": {"trust": -0.30, "respect": -0.20, "attraction": -0.15},
    "romantic": {"attraction": 0.10, "trust": 0.04, "familiarity": 0.05},
    "breakup": {"trust": -0.15, "attraction": -0.25},
    "shared_experience": {"familiarity": 0.08, "trust": 0.03},
    "trauma": {"trust": -0.25, "respect": -0.15},
}

# ─── Mood System ────────────────────────────────────────────────────────────

MOOD_STATES = [
    "ecstatic",
    "happy",
    "content",
    "neutral",
    "bored",
    "sad",
    "angry",
    "anxious",
    "excited",
    "romantic",
    "heartbroken",
    "vengeful",
]

# Mood intensity levels
MOOD_INTENSITY_LEVELS = {
    "low": (0.0, 0.3),
    "medium": (0.3, 0.6),
    "high": (0.6, 1.0),
}

# Mood transition rules
# Format: {current_mood: {trigger: (new_mood, intensity_change), ...}}
MOOD_TRANSITIONS = {
    "neutral": {
        "positive_interaction": ("content", 0.2),
        "negative_interaction": ("sad", 0.3),
        "conflict": ("angry", 0.4),
        "romantic_interaction": ("romantic", 0.3),
        "exciting_event": ("excited", 0.4),
        "boredom": ("bored", 0.1),
    },
    "content": {
        "positive_interaction": ("happy", 0.2),
        "negative_interaction": ("neutral", -0.2),
        "conflict": ("angry", 0.3),
        "romantic_interaction": ("romantic", 0.3),
        "exciting_event": ("excited", 0.3),
    },
    "happy": {
        "positive_interaction": ("ecstatic", 0.2),
        "negative_interaction": ("content", -0.3),
        "conflict": ("sad", 0.4),
        "great_news": ("ecstatic", 0.3),
    },
    "ecstatic": {
        "time_passes": ("happy", -0.1),
        "negative_interaction": ("content", -0.4),
    },
    "bored": {
        "positive_interaction": ("content", 0.3),
        "exciting_event": ("excited", 0.4),
        "socialize": ("content", 0.2),
    },
    "sad": {
        "positive_interaction": ("neutral", 0.2),
        "comfort": ("content", 0.3),
        "time_passes": ("neutral", 0.05),
        "breakup": ("heartbroken", 0.5),
    },
    "angry": {
        "conflict": ("vengeful", 0.3),
        "reconciliation": ("neutral", 0.4),
        "time_passes": ("neutral", 0.03),
        "betrayal": ("vengeful", 0.4),
    },
    "anxious": {
        "positive_outcome": ("content", 0.3),
        "negative_outcome": ("sad", 0.3),
        "time_passes": ("neutral", 0.05),
    },
    "excited": {
        "time_passes": ("happy", -0.1),
        "disappointment": ("sad", 0.3),
        "event_occurs": ("happy", 0.1),
    },
    "romantic": {
        "romantic_interaction": ("happy", 0.2),
        "rejection": ("sad", 0.4),
        "breakup": ("heartbroken", 0.5),
        "time_passes": ("content", -0.05),
    },
    "heartbroken": {
        "time_passes": ("sad", 0.02),
        "comfort": ("sad", 0.2),
        "new_romance": ("romantic", 0.3),
    },
    "vengeful": {
        "revenge": ("content", 0.3),
        "forgiveness": ("neutral", 0.4),
        "time_passes": ("angry", -0.02),
    },
}

# Mood effects on behavior
MOOD_BEHAVIOR_MODIFIERS = {
    "ecstatic": {
        "social_eagerness": 1.5,
        "forgiveness_chance": 1.3,
        "activity_energy": 1.3,
    },
    "happy": {
        "social_eagerness": 1.3,
        "forgiveness_chance": 1.2,
        "activity_energy": 1.1,
    },
    "content": {
        "social_eagerness": 1.0,
        "forgiveness_chance": 1.0,
        "activity_energy": 1.0,
    },
    "neutral": {
        "social_eagerness": 0.9,
        "forgiveness_chance": 1.0,
        "activity_energy": 1.0,
    },
    "bored": {
        "social_eagerness": 1.2,  # Seek stimulation
        "forgiveness_chance": 0.9,
        "activity_energy": 0.8,
    },
    "sad": {
        "social_eagerness": 0.6,
        "forgiveness_chance": 0.8,
        "activity_energy": 0.7,
    },
    "angry": {
        "social_eagerness": 0.7,
        "forgiveness_chance": 0.3,
        "conflict_chance": 2.0,
        "activity_energy": 1.2,
    },
    "anxious": {
        "social_eagerness": 0.5,
        "forgiveness_chance": 0.7,
        "activity_energy": 0.9,
    },
    "excited": {
        "social_eagerness": 1.4,
        "forgiveness_chance": 1.1,
        "activity_energy": 1.4,
    },
    "romantic": {
        "social_eagerness": 1.3,
        "romantic_approach_chance": 1.5,
        "activity_energy": 1.1,
    },
    "heartbroken": {
        "social_eagerness": 0.4,
        "forgiveness_chance": 0.5,
        "activity_energy": 0.5,
    },
    "vengeful": {
        "social_eagerness": 0.6,
        "conflict_chance": 3.0,
        "forgiveness_chance": 0.1,
    },
}

# Natural mood decay (per world-hour)
MOOD_NATURAL_DECAY_RATE = 0.02

# Minimum mood duration (in ticks) before natural decay
MOOD_MIN_DURATION_TICKS = 4

# ─── Personality System ─────────────────────────────────────────────────────

# Big Five personality traits with descriptions
PERSONALITY_TRAITS = {
    "extraversion": {
        "description": "Sociability and energy from social interaction",
        "low": "Introverted, prefers solitude",
        "high": "Extroverted, energized by people",
        "range": (0.0, 1.0),
    },
    "agreeableness": {
        "description": "Tendency toward compassion and cooperation",
        "low": "Competitive, critical, suspicious",
        "high": "Trusting, helpful, compassionate",
        "range": (0.0, 1.0),
    },
    "neuroticism": {
        "description": "Emotional instability and negative emotions",
        "low": "Calm, emotionally stable",
        "high": "Anxious, moody, easily stressed",
        "range": (0.0, 1.0),
    },
    "conscientiousness": {
        "description": "Organization and dependability",
        "low": "Spontaneous, flexible, disorganized",
        "high": "Organized, disciplined, reliable",
        "range": (0.0, 1.0),
    },
    "openness": {
        "description": "Openness to new experiences and ideas",
        "low": "Traditional, prefers routine",
        "high": "Curious, creative, adventurous",
        "range": (0.0, 1.0),
    },
}

# Derived traits calculated from Big Five
DERIVED_TRAIT_FORMULAS = {
    # jealousy_tendency: High neuroticism + low agreeableness
    "jealousy_tendency": lambda p: p["neuroticism"] * 0.6 + (1 - p["agreeableness"]) * 0.4,
    
    # forgiveness_rate: High agreeableness + low neuroticism
    "forgiveness_rate": lambda p: p["agreeableness"] * 0.7 + (1 - p["neuroticism"]) * 0.3,
    
    # social_energy: Directly from extraversion
    "social_energy": lambda p: p["extraversion"],
    
    # commitment_level: High conscientiousness + high agreeableness
    "commitment_level": lambda p: p["conscientiousness"] * 0.5 + p["agreeableness"] * 0.5,
    
    # conflict_tendency: Low agreeableness + high neuroticism
    "conflict_tendency": lambda p: (1 - p["agreeableness"]) * 0.6 + p["neuroticism"] * 0.4,
    
    # gossip_tendency: High extraversion + low conscientiousness
    "gossip_tendency": lambda p: p["extraversion"] * 0.6 + (1 - p["conscientiousness"]) * 0.4,
    
    # romantic_eagerness: High extraversion + high openness
    "romantic_eagerness": lambda p: p["extraversion"] * 0.5 + p["openness"] * 0.5,
    
    # loyalty: High agreeableness + high conscientiousness
    "loyalty": lambda p: p["agreeableness"] * 0.6 + p["conscientiousness"] * 0.4,
    
    # trust_tendency: High agreeableness + low neuroticism
    "trust_tendency": lambda p: p["agreeableness"] * 0.6 + (1 - p["neuroticism"]) * 0.4,
    
    # adventure_seeking: High openness + high extraversion
    "adventure_seeking": lambda p: p["openness"] * 0.6 + p["extraversion"] * 0.4,
}

# Personality effects on relationship changes
PERSONALITY_RELATIONSHIP_MODIFIERS = {
    "positive_interaction": {
        "trust": lambda p: 1.0 + p["agreeableness"] * 0.5,
        "familiarity": lambda p: 1.0 + p["extraversion"] * 0.3,
        "attraction": lambda p: 1.0 + p["openness"] * 0.3,
    },
    "negative_interaction": {
        "trust": lambda p: 1.0 + p["neuroticism"] * 0.5,  # Neurotic people take it harder
        "respect": lambda p: 1.0 + (1 - p["agreeableness"]) * 0.3,
    },
    "conflict": {
        "trust": lambda p: 1.0 + p["neuroticism"] * 0.8,
        "respect": lambda p: 1.0 + (1 - p["agreeableness"]) * 0.5,
    },
    "romantic_interaction": {
        "attraction": lambda p: 1.0 + p["openness"] * 0.5 + p["extraversion"] * 0.3,
    },
}

# ─── Social Groups ──────────────────────────────────────────────────────────

GROUP_TYPES = [
    "clique",        # Friend group
    "work_group",    # Colleagues
    "family",        # Family members
    "romantic",      # Dating/married couple
    "rivalry",       # Competing individuals
    "community",     # Neighborhood/community
]

# Group formation thresholds
GROUP_FORMATION_THRESHOLDS = {
    "clique": {
        "min_members": 3,
        "max_members": 8,
        "min_cohesion": 0.5,  # Average relationship quality
        "min_shared_memories": 2,
    },
    "work_group": {
        "min_members": 2,
        "max_members": 10,
        "min_cohesion": 0.3,
        "location_type": ["office", "factory", "shop", "school", "hospital", "studio"],
    },
    "family": {
        "min_members": 2,
        "max_members": 6,
        "min_cohesion": 0.4,
        "shared_home": True,
    },
    "romantic": {
        "min_members": 2,
        "max_members": 2,
        "min_cohesion": 0.7,
        "relationship_type": ["dating", "partner"],
    },
}

# Group cohesion change rates
GROUP_COHESION_CHANGE = {
    "shared_positive_experience": 0.05,
    "shared_negative_experience": 0.02,  # Can bond over shared hardship
    "internal_conflict": -0.10,
    "member_leaves": -0.15,
    "new_member_joins": -0.05,
    "time_without_interaction": -0.01,
}

# ─── Rumors & Gossip ────────────────────────────────────────────────────────

RUMOR_TYPES = [
    "romantic",      # "X and Y are dating!"
    "conflict",      # "X and Y had a huge fight"
    "secret",        # "X is hiding something"
    "achievement",   # "X did something impressive"
    "scandal",       # "X did something shameful"
    "betrayal",      # "X betrayed Y"
    "false",         # Completely fabricated
]

# Rumor spread rate modifiers
RUMOR_SPREAD_MODIFIERS = {
    "base_rate": 0.1,  # Per tick per NPC
    "extraversion_mult": 0.5,  # Extra per extraversion point
    "gossip_tendency_mult": 0.3,
    "accuracy_decay": 0.05,  # Rumors become less accurate as they spread
}

# Rumor impact on reputation
RUMOR_REPUTATION_IMPACT = {
    "romantic": 0.0,      # Neutral
    "conflict": -0.05,    # Slightly negative
    "secret": -0.03,
    "achievement": 0.10,  # Positive
    "scandal": -0.15,     # Very negative
    "betrayal": -0.20,
    "false": 0.0,         # Depends on content
}

# ─── Conflict System ────────────────────────────────────────────────────────

CONFLICT_TYPES = [
    "disagreement",  # Minor difference of opinion
    "argument",      # Heated verbal conflict
    "rivalry",       # Ongoing competition
    "feud",          # Long-term hostility
    "betrayal",      # Major trust violation
]

# Conflict escalation thresholds
CONFLICT_ESCALATION_THRESHOLDS = {
    "disagreement": {
        "trust_threshold": 0.0,
        "escalation_chance": 0.1,
        "next_stage": "argument",
    },
    "argument": {
        "trust_threshold": -0.1,
        "escalation_chance": 0.2,
        "next_stage": "rivalry",
    },
    "rivalry": {
        "trust_threshold": -0.25,
        "escalation_chance": 0.15,
        "next_stage": "feud",
    },
    "feud": {
        "trust_threshold": -0.40,
        "escalation_chance": 0.1,
        "next_stage": None,  # Maximum escalation
    },
}

# Conflict resolution chances
CONFLICT_RESOLUTION_BASE_CHANCE = {
    "disagreement": 0.4,
    "argument": 0.25,
    "rivalry": 0.15,
    "feud": 0.05,
    "betrayal": 0.02,
}

# ─── Romantic Progression ───────────────────────────────────────────────────

ROMANTIC_STAGES = [
    "stranger",
    "acquaintance",
    "friend",
    "close_friend",
    "crush",
    "dating",
    "partner",
]

# Crush formation chances
CRUSH_FORMATION_CHANCE = {
    "base": 0.02,  # Per interaction
    "attraction_mult": 0.5,  # Multiplied by attraction level
    "zodiac_compat_mult": 0.3,  # Multiplied by zodiac compatibility
    "personality_compat_mult": 0.2,
}

# Dating progression requirements
DATING_PROGRESSION_REQUIREMENTS = {
    "crush_to_dating": {
        "mutual_crush": True,  # OR confession accepted
        "min_trust": 0.4,
        "min_familiarity": 0.4,
    },
    "dating_to_partner": {
        "min_duration_world_hours": 100,  # ~4 world days
        "min_trust": 0.7,
        "min_familiarity": 0.6,
        "min_positive_interactions": 10,
    },
}

# Breakup triggers and chances
BREAKUP_TRIGGERS = {
    "trust_betrayal": {
        "trust_threshold": -0.2,
        "chance": 0.8,
    },
    "attraction_fade": {
        "attraction_threshold": 0.2,
        "duration_threshold_world_hours": 50,
        "chance": 0.3,
    },
    "incompatibility": {
        "conflict_count_threshold": 5,
        "chance": 0.4,
    },
    "external_pressure": {
        "chance": 0.05,  # Random external events
    },
    "random": {
        "base_chance": 0.002,  # Per tick for unstable relationships
        "commitment_protection": 0.8,  # High commitment reduces chance
    },
}

# ─── Dynamic Society Mechanics ──────────────────────────────────────────────

# Chaos factor curve
CHAOS_FACTOR_CONFIG = {
    "initial_chaos": 1.0,
    "min_chaos": 0.2,  # Never goes below 20%
    "decay_rate": 0.0002,  # Per tick
    "stabilization_tick": 5000,  # When chaos reaches minimum
}

# Home leaving triggers (Chances scaled per world-hour)
HOME_LEAVING_TRIGGERS = {
    "hostile_environment": {
        "min_relationship_with_all_housemates": 0.15,
        "duration_threshold_ticks": 100,
        "chance": 0.002,
    },
    "unresolved_conflict": {
        "conflict_severity_threshold": 0.6,
        "duration_threshold_ticks": 200,
        "chance": 0.003,
    },
    "breakup_shared_home": {
        "chance": 0.05, # Significant chance to move out after breakup
    },
    "financial_opportunity": {
        "money_threshold": 500.0, # Higher threshold
        "chance": 0.001,
    },
    "wanderlust": {
        "conscientiousness_threshold": 0.2, # Extremely low conscientiousness
        "chance": 0.0002,
    },
}

# Random shock events
RANDOM_SHOCK_EVENTS = {
    "new_npc_arrival": {
        "chance_per_tick": 0.0001,
        "chaos_boost": 0.1,
    },
    "major_betrayal_discovered": {
        "chance_per_tick": 0.0005,
        "chaos_boost": 0.15,
    },
    "rumor_chain_reaction": {
        "chance_per_tick": 0.001,
        "chaos_boost": 0.05,
    },
    "economic_crisis": {
        "chance_per_tick": 0.00005,
        "chaos_boost": 0.2,
        "duration_ticks": 100,
    },
}

# ─── New Needs ──────────────────────────────────────────────────────────────

NEW_NEEDS = {
    "entertainment": {
        "increase_rate": 1.0 / 20.0,  # Full in ~20 world hours
        "activity": "relax",
        "description": "Need for fun and stimulation",
    },
    "intimacy": {
        "increase_rate": 1.0 / 48.0,  # Full in ~48 world hours (2 days)
        "activity": "socialize",  # Or romantic interaction
        "description": "Need for close emotional/physical connection",
    },
    "autonomy": {
        "increase_rate": 1.0 / 72.0,  # Full in ~72 world hours (3 days)
        "activity": "wander",  # Independent exploration
        "description": "Need for independence and self-direction",
    },
}

# Need-personality interactions
NEED_PERSONALITY_MODIFIERS = {
    "social": {
        "increase_rate": lambda p: 1.0 + (1 - p["extraversion"]) * 0.5,  # Introverts need less
    },
    "entertainment": {
        "increase_rate": lambda p: 1.0 + p["openness"] * 0.3,
    },
    "intimacy": {
        "increase_rate": lambda p: 1.0 + p["extraversion"] * 0.2 + p["neuroticism"] * 0.2,
    },
    "autonomy": {
        "increase_rate": lambda p: 1.0 + (1 - p["agreeableness"]) * 0.3,
    },
}
