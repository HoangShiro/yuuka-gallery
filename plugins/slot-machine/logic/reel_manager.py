# --- MODIFIED FILE: plugins/slot-machine/logic/reel_manager.py ---
import random
from .constants import GAME_CONFIG, SPECIAL_CARD_CONFIGS, SPECIAL_CARD_PAIRINGS

class ReelManager:
    """Quản lý dữ liệu guồng quay, lựa chọn nhân vật và gán thẻ đặc biệt."""
    def __init__(self, character_pool, config):
        self.character_pool = character_pool
        self.is_mobile = config.get("is_mobile", False)
        self.reel_count = config.get("reel_count")
        self.symbols_per_reel = config.get("symbols_per_reel")
        self.reel_characters = []

    def generate_all_reels(self):
        available_chars = list(self.character_pool)
        target_size = min(self.symbols_per_reel, len(available_chars))
        
        if len(available_chars) < target_size:
            base_reel_set = available_chars
        else:
            base_reel_set = random.sample(available_chars, target_size)

        self.reel_characters = []
        for _ in range(self.reel_count):
            shuffled_reel = list(base_reel_set)
            random.shuffle(shuffled_reel)
            self.reel_characters.append(shuffled_reel)
        return self.reel_characters

    def determine_final_results(self, force_jackpot=False):
        if force_jackpot:
            source_reel = next((r for r in self.reel_characters if r), None)
            if source_reel:
                jackpot_char = random.choice(source_reel)
            else:
                jackpot_char = random.choice(self.character_pool)
            return [jackpot_char] * self.reel_count
        
        return [random.choice(reel) if reel else None for reel in self.reel_characters]

    def assign_session_special_cards(self):
        session_assignment = {}
        all_possible_positions = []
        for r_idx, reel in enumerate(self.reel_characters):
            for c_idx in range(len(reel)):
                all_possible_positions.append({"reel_index": r_idx, "char_index": c_idx})
        
        random.shuffle(all_possible_positions)

        config_by_id = {cfg['id']: cfg for cfg in SPECIAL_CARD_CONFIGS}
        paired_ids = {id for pair in SPECIAL_CARD_PAIRINGS for id in pair}

        for first_id, second_id in SPECIAL_CARD_PAIRINGS:
            first_config = config_by_id.get(first_id)
            second_config = config_by_id.get(second_id)
            if not first_config or not second_config: continue

            pair_chance = min(first_config.get('chance', 1), second_config.get('chance', 1))
            pair_max = min(first_config.get('maxPerSpin', 1), second_config.get('maxPerSpin', 1))

            for _ in range(pair_max):
                if len(all_possible_positions) < 2: break
                if random.random() < pair_chance:
                    pos1, pos2 = all_possible_positions.pop(), all_possible_positions.pop()
                    session_assignment[f"{pos1['reel_index']},{pos1['char_index']}"] = first_config
                    session_assignment[f"{pos2['reel_index']},{pos2['char_index']}"] = second_config

        for effect_config in SPECIAL_CARD_CONFIGS:
            if effect_config['id'] in paired_ids: continue
            
            max_spins = effect_config.get('maxPerSpin', 1)
            for _ in range(max_spins):
                if not all_possible_positions: break
                if random.random() < effect_config.get('chance', 1):
                    pos = all_possible_positions.pop()
                    session_assignment[f"{pos['reel_index']},{pos['char_index']}"] = effect_config
        
        return session_assignment

    def process_specials_for_grid(self, final_card_indices, session_special_map):
        """
        Yuuka: Xử lý các hiệu ứng đặc biệt cho lưới 3x3 hiện tại.
        Hàm này được port từ phiên bản JS cũ.
        """
        assignments = {}
        summary = {
            "multipliers": [], "penalties": [], "freeSpins": [], "respins": 0,
            "bonusPoints": [], "swaps": [], "clears": [], "clearReassignments": [],
            "reverseSpins": []
        }

        for i in range(self.reel_count):
            reel_chars = self.reel_characters[i]
            if not reel_chars: continue

            reel_len = len(reel_chars)
            center_index = final_card_indices[i]
            indices_in_reel = [(center_index - 1 + reel_len) % reel_len, center_index, (center_index + 1) % reel_len]

            for j, char_index in enumerate(indices_in_reel):
                key = f"{i},{char_index}"
                if key in session_special_map:
                    effect_config = session_special_map[key]
                    assignment_effect = {**effect_config, "__sessionKey": key}
                    
                    row = j if self.is_mobile else i
                    col = i if self.is_mobile else j
                    grid_key = f"{row},{col}"

                    position = {"key": grid_key, "row": row, "column": col, "charIndex": char_index, "reelIndex": i}
                    assignments[grid_key] = {
                        "effect": assignment_effect,
                        "position": position,
                        "sessionKey": key
                    }

                    category = assignment_effect.get("category")
                    if category == 'multiplier':
                        summary["multipliers"].append(assignment_effect)
                    elif category == 'penalty':
                        summary["penalties"].append(assignment_effect)
                    elif category == 'free-spin':
                        summary["freeSpins"].append(assignment_effect)
                    elif category == 'respin':
                        summary["respins"] += assignment_effect.get("respins", 1)
                    elif category == 'reverse-spin':
                        summary["reverseSpins"].append(assignment_effect)
                    elif category == 'bonus-points':
                        summary["bonusPoints"].append(assignment_effect)
                    elif category == 'swap':
                        summary["swaps"].append({"effect": assignment_effect, "position": position})
                    elif category == 'clear':
                        summary["clears"].append({"effect": assignment_effect, "position": position})
        
        return {"assignments": assignments, "summary": summary}