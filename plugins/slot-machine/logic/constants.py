# --- MODIFIED FILE: plugins/slot-machine/logic/constants.py ---
# Yuuka: File cấu hình trung tâm cho Slot Machine, giờ đây ở phía backend.

GAME_CONFIG = {
    "SPIN_COST": 10,
    "FREE_SPINS_ON_EMPTY": 3,
    "MIN_CHARS_REQUIRED": 20,
    "DESKTOP_ROW_COUNT": 3,
    "DESKTOP_SYMBOLS_PER_ROW": 21,
    "MOBILE_COLUMN_COUNT": 3,
    "MOBILE_SYMBOLS_PER_COLUMN": 21,
    "SPIN_DURATION_BASE": 4000,
    "SPIN_DURATION_STAGGER": 500,
    "REVEAL_EVENT_DELAY": 400,
    "AUTO_SPIN_DELAY": 600,
    "JACKPOT_ANIMATION_DURATION": 10000,
}

SCORE_MAP = {
    "NORMAL_WIN_2_KIND": 10,
    "NORMAL_WIN_3_SCATTER_1_MID": 30,
    "NORMAL_WIN_3_SCATTER_2_MID": 50,
    "NORMAL_WIN_3_LINE": 120,
    "NORMAL_WIN_BIG_JACKPOT": 500,
    "PICKED_PENALTY_NO_SHOW": -20,
    "PICKED_BONUS_ONE_SHOW": 40,
    "PICKED_BONUS_2_SCATTER": 60,
    "PICKED_BONUS_3_SCATTER": 100,
    "PICKED_MULTIPLIER_2_KIND": 10,
    "PICKED_MULTIPLIER_3_SCATTER": 10,
    "PICKED_MULTIPLIER_3_LINE": 10,
    "PICKED_MULTIPLIER_BIG_JACKPOT": 20,
}

WIN_TYPE_NAMES = {
    '2_KIND': 'DOUBLE',
    '3_SCATTER': 'TRIPLE',
    '3_LINE': 'LINE',
    'BIG_JACKPOT': 'JACKPOT!',
    'PICKED_BONUS_ONE_SHOW': 'LUCKY PICK',
    'PICKED_BONUS_2_SCATTER': 'DOUBLE PICK',
    'PICKED_BONUS_3_SCATTER': 'TRIPLE PICK',
    'PICKED_PENALTY_NO_SHOW': 'MISS'
}

SPECIAL_CARD_CONFIGS = [
    { "id": 'respin', "category": 'respin', "icon": 'autorenew', "badgeLabel": None, "respins": 1, "maxPerSpin": 1, "chance": 0.8 },
    { "id": 'reverse_spin', "category": 'reverse-spin', "icon": 'u_turn_left', "badgeLabel": None, "maxPerSpin": 1, "chance": 0.8 },
    { "id": 'multiplier_x2', "category": 'multiplier', "icon": 'filter_2', "badgeLabel": 'x2', "multiplier": 2, "maxPerSpin": 1, "chance": 0.5 },
    { "id": 'multiplier_x3', "category": 'multiplier', "icon": 'filter_3', "badgeLabel": 'x3', "multiplier": 3, "maxPerSpin": 1, "chance": 0.1 },
    { "id": 'multiplier_x5', "category": 'multiplier', "icon": 'filter_5', "badgeLabel": 'x5', "multiplier": 5, "maxPerSpin": 1, "chance": 0.01 },
    { "id": 'multiplier_x10', "category": 'multiplier', "icon": 'filter_9_plus', "badgeLabel": 'x10', "multiplier": 10, "maxPerSpin": 1, "chance": 0.005 },
    { "id": 'penalty_percent_neg_5', "category": 'penalty', "icon": 'percent', "badgeLabel": '-5%', "scorePercent": 0.05, "maxPerSpin": 1, "chance": 0.5 },
    { "id": 'penalty_percent_neg_10', "category": 'penalty', "icon": 'percent', "badgeLabel": '-10%', "scorePercent": 0.1, "maxPerSpin": 1, "chance": 0.1 },
    { "id": 'penalty_percent_neg_25', "category": 'penalty', "icon": 'percent', "badgeLabel": '-25%', "scorePercent": 0.25, "maxPerSpin": 1, "chance": 0.01 },
    { "id": 'penalty_percent_neg_50', "category": 'penalty', "icon": 'percent', "badgeLabel": '-50%', "scorePercent": 0.5, "maxPerSpin": 1, "chance": 0.005 },
    { "id": 'penalty_neg_10', "category": 'penalty', "icon": 'remove', "badgeLabel": '10', "scoreDelta": -10, "maxPerSpin": 2, "chance": 1 },
    { "id": 'penalty_neg_50', "category": 'penalty', "icon": 'remove', "badgeLabel": '50', "scoreDelta": -50, "maxPerSpin": 1, "chance": 0.5 },
    { "id": 'penalty_neg_100', "category": 'penalty', "icon": 'skull', "badgeLabel": '100', "scoreDelta": -100, "maxPerSpin": 1, "chance": 0.08 },
    { "id": 'free_plus_1', "category": 'free-spin', "icon": 'featured_seasonal_and_gifts', "badgeLabel": '+1', "freeSpins": 1, "maxPerSpin": 2, "chance": 1 },
    { "id": 'free_plus_2', "category": 'free-spin', "icon": 'featured_seasonal_and_gifts', "badgeLabel": '+2', "freeSpins": 2, "maxPerSpin": 1, "chance": 0.1 },
    { "id": 'free_plus_5', "category": 'free-spin', "icon": 'featured_seasonal_and_gifts', "badgeLabel": '+5', "freeSpins": 5, "maxPerSpin": 1, "chance": 0.05 },
    { "id": 'swap_adjacent', "category": 'swap', "icon": 'swap_horiz', "badgeLabel": 'SW', "maxPerSpin": 2, "chance": 0.5, "swapMode": 'adjacent' },
    { "id": 'swap_row', "category": 'swap', "icon": 'sync_alt', "badgeLabel": 'RW', "maxPerSpin": 1, "chance": 0.4, "swapMode": 'row-any' },
    { "id": 'clear', "category": 'clear', "icon": 'ink_eraser', "badgeLabel": 'CLR', "maxPerSpin": 1, "chance": 0.5 },
    { "id": 'bonus_plus_10', "category": 'bonus-points', "icon": 'add_circle', "badgeLabel": '10', "scoreDelta": 10, "maxPerSpin": 2, "chance": 1 },
    { "id": 'bonus_plus_50', "category": 'bonus-points', "icon": 'add_circle', "badgeLabel": '50', "scoreDelta": 50, "maxPerSpin": 1, "chance": 0.1 },
    { "id": 'bonus_plus_100', "category": 'bonus-points', "icon": 'workspace_premium', "badgeLabel": '100', "scoreDelta": 100, "maxPerSpin": 1, "chance": 0.05 },
]

SPECIAL_CARD_PAIRINGS = [
    ['bonus_plus_10', 'penalty_neg_10'],
    ['bonus_plus_50', 'penalty_neg_50'],
    ['bonus_plus_100', 'penalty_neg_100'],
    ['multiplier_x2', 'penalty_percent_neg_5'],
    ['multiplier_x3', 'penalty_percent_neg_10'],
    ['multiplier_x5', 'penalty_percent_neg_25'],
    ['multiplier_x10', 'penalty_percent_neg_50'],
]