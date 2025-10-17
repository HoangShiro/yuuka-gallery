# --- MODIFIED FILE: plugins/slot-machine/logic/result_processor.py ---
from .constants import SCORE_MAP, WIN_TYPE_NAMES

class ResultProcessor:
    """Xử lý logic tính điểm từ lưới kết quả 3x3."""
    def __init__(self, grid, picked_hash, was_free_spin, special_context, session_score_before_spin=0):
        self.grid = grid
        self.picked_hash = picked_hash
        self.was_free_spin = was_free_spin
        self.special_context = special_context or {"summary": {}}
        self.summary = self.special_context.setdefault("summary", {})
        self.jackpot_character = None
        self.session_score_before_spin = max(session_score_before_spin or 0, 0)

        # Khởi tạo các list trong summary nếu chưa có
        for key in ['multipliers', 'penalties', 'freeSpins', 'bonusPoints', 'swaps', 'clears', 'clearReassignments', 'reverseSpins']:
            self.summary.setdefault(key, [])
        self.summary.setdefault('respins', 0)

        self.base_wins = []
        self.winning_groups = []
        self.processed_coords = set()
        self.highest_win_type = 'none'
        self.all_coords = [(r, c) for r in range(3) for c in range(3)]

    def calculate(self):
        self._find_base_wins()
        self._promote_center_jackpot_if_needed()
        if self.highest_win_type == 'jackpot' and not self.jackpot_character:
            center = self._get_grid_cell(1, 1)
            if center and center.get('hash'):
                # Gửi nguyên bản dữ liệu nhân vật cho frontend hiển thị
                self.jackpot_character = center
        
        total_score = 0
        events = []

        for win in self.base_wins:
            total_score += win['score']
            events.append({
                "text": WIN_TYPE_NAMES.get(win['type'], ''), "score": win['score'],
                "type": 'jackpot' if self.highest_win_type == 'jackpot' else ('nearmiss' if self.highest_win_type == 'nearmiss' else 'normal')
            })
        
        base_win_score = total_score
        
        picked_bonus = self._apply_picked_character_bonus()
        if picked_bonus['score'] != 0:
            total_score += picked_bonus['score']
            events.append({
                "text": picked_bonus['text'], "score": picked_bonus['score'],
                "type": 'normal' if picked_bonus['score'] > 0 else 'penalty'
            })

        if self.highest_win_type == 'jackpot':
            # Jackpot overrides respin rewards so the celebration does not auto-trigger another spin.
            self.summary['respins'] = 0

        special_effects = self._apply_special_card_effects(total_score, base_win_score)
        total_score = special_effects['final_score']
        events.extend(special_effects['events'])
        
        return {
            "totalScore": total_score,
            "highestWinType": self.highest_win_type,
            "winningGroups": self.winning_groups,
            "freeSpinsAwarded": special_effects['free_spins_awarded'],
            "respinCount": self.summary.get('respins', 0),
            "reverseSpinCount": len(self.summary.get('reverseSpins', [])),
            "eventsToDisplay": events,
            # Yuuka: Gửi lại thông tin swap chi tiết cho frontend để chạy animation
            "executedSwaps": self.summary.get('swaps', []),
            "jackpotCharacter": self.jackpot_character,
        }

    def _apply_special_card_effects(self, current_score, base_win_score):
        events = []
        final_score = current_score
        free_spins_awarded = 0
        
        if self.summary.get('multipliers'):
            multiplier_factor = 1
            labels = []
            for effect in self.summary['multipliers']:
                multiplier_factor *= effect.get('multiplier', 1)
                labels.append(effect.get('badgeLabel', f"x{effect.get('multiplier')}"))
            
            gain = round(max(base_win_score, 0) * multiplier_factor) - max(base_win_score, 0)
            final_score += gain
            events.append({"text": "MULTIPLIER", "score": gain, "type": "bonus" if gain >= 0 else "penalty", "displayValue": ' x '.join(labels)})

        if self.summary.get('penalties'):
            for effect in self.summary['penalties']:
                delta = 0
                if 'scorePercent' in effect:
                    base_total = self.session_score_before_spin
                    delta = -round(base_total * effect['scorePercent'])
                    display = effect.get('badgeLabel', f"-{effect['scorePercent']*100}%")
                elif 'scoreDelta' in effect:
                    delta = effect['scoreDelta']
                    display = effect.get('badgeLabel')
                
                final_score += delta
                events.append({"text": "PENALTY", "score": delta, "type": "penalty", "displayValue": display})

        if self.summary.get('bonusPoints'):
            for effect in self.summary['bonusPoints']:
                delta = effect.get('scoreDelta', 0)
                final_score += delta
                events.append({"text": "BONUS", "score": delta, "type": "bonus", "displayValue": f"+{delta}"})

        if self.summary.get('freeSpins'):
            for effect in self.summary['freeSpins']:
                spins = effect.get('freeSpins', 0)
                free_spins_awarded += spins
                events.append({"text": "FREE SPINS", "score": 0, "type": "bonus", "displayValue": f"+{spins}"})
        
        if self.summary.get('swaps'):
             for entry in self.summary['swaps']:
                 events.append({"text": "SWAP", "score": 0, "type": "bonus", "displayValue": entry.get('displayLabel', 'SW')})
        
        if self.summary.get('clears'):
            successful_moves = sum(1 for item in self.summary.get('clearReassignments', []) if not item.get('stuck'))
            total_moves = len(self.summary.get('clearReassignments', []))
            display_value = f"{successful_moves}/{total_moves} MOVED" if total_moves > 0 else "SHIFT"
            events.append({"text": "CLEAR", "score": 0, "type": "bonus", "displayValue": display_value})

        if self.summary.get('respins', 0) > 0:
            count = self.summary['respins']
            events.append({"text": "RESPIN", "score": 0, "type": "bonus", "displayValue": f"x{count}" if count > 1 else "AUTO"})

        if self.summary.get('reverseSpins'):
            count = len(self.summary['reverseSpins'])
            events.append({"text": "REVERSE", "score": 0, "type": "bonus", "displayValue": f"x{count}" if count > 1 else "REV"})

        return {"final_score": final_score, "events": events, "free_spins_awarded": free_spins_awarded}

    def _find_base_wins(self):
        jackpot_lines = [
            [(1, 0), (1, 1), (1, 2)],
            [(0, 1), (1, 1), (2, 1)],
        ]
        for line in jackpot_lines:
            chars = [self.grid[r][c] for r, c in line]
            if all(c and c.get('hash') and c.get('hash') == chars[0].get('hash') for c in chars):
                self._add_win('BIG_JACKPOT', chars[0]['hash'], SCORE_MAP['NORMAL_WIN_BIG_JACKPOT'], line, 'jackpot')

        lines = [
            [(0, 0), (0, 1), (0, 2)], [(2, 0), (2, 1), (2, 2)],
            [(0, 0), (1, 0), (2, 0)], [(0, 2), (1, 2), (2, 2)],
            [(0, 0), (1, 1), (2, 2)], [(0, 2), (1, 1), (2, 0)],
        ]
        for line in lines:
            self._check_line(line)
        
        self._find_scatters(3)
        self._find_pairs()

    def _add_win(self, type, hash_val, score, coords, win_level):
        coord_keys = {f"{r},{c}" for r, c in coords}
        if any(key in self.processed_coords for key in coord_keys):
            return
        
        self.base_wins.append({"type": type, "hash": hash_val, "score": score})
        self.winning_groups.append({"winLevel": win_level, "coords": list(coord_keys)})
        self.processed_coords.update(coord_keys)

        if win_level == 'jackpot': self.highest_win_type = 'jackpot'
        elif win_level == 'nearmiss' and self.highest_win_type != 'jackpot': self.highest_win_type = 'nearmiss'
        elif win_level == 'normal-win' and self.highest_win_type == 'none': self.highest_win_type = 'normal-win'

    def _check_line(self, line_coords):
        chars = [self.grid[r][c] for r, c in line_coords]
        if all(c and c.get('hash') and c.get('hash') == chars[0].get('hash') for c in chars):
            self._add_win('3_LINE', chars[0]['hash'], SCORE_MAP['NORMAL_WIN_3_LINE'], line_coords, 'nearmiss')
    
    def _find_scatters(self, count):
        remaining_coords = [c for c in self.all_coords if f"{c[0]},{c[1]}" not in self.processed_coords]
        char_counts = {}
        for r, c in remaining_coords:
            char = self.grid[r][c]
            if char and char.get('hash'):
                h = char['hash']
                if h not in char_counts: char_counts[h] = {"count": 0, "mid_cols": 0, "coords": []}
                char_counts[h]['count'] += 1
                char_counts[h]['coords'].append((r, c))
                if c == 1: char_counts[h]['mid_cols'] += 1
        
        for h, data in char_counts.items():
            if data['count'] == count:
                score = SCORE_MAP['NORMAL_WIN_3_SCATTER_2_MID'] if data['mid_cols'] == 2 else SCORE_MAP['NORMAL_WIN_3_SCATTER_1_MID']
                self._add_win('3_SCATTER', h, score, data['coords'], 'normal-win')

    def _find_pairs(self):
        coords_to_check = [c for c in self.all_coords if f"{c[0]},{c[1]}" not in self.processed_coords]
        adjacency_deltas = [[0, 1], [1, 0], [1, 1], [1, -1]]
        
        processed_in_pass = set()

        for r1, c1 in coords_to_check:
            coord1_key = f"{r1},{c1}"
            if coord1_key in processed_in_pass: continue

            char1 = self.grid[r1][c1]
            if not char1 or not char1.get('hash'): continue

            for dr, dc in adjacency_deltas:
                r2, c2 = r1 + dr, c1 + dc
                coord2_key = f"{r2},{c2}"
                if f"{r2},{c2}" in self.processed_coords or coord2_key in processed_in_pass: continue
                
                if 0 <= r2 < 3 and 0 <= c2 < 3:
                    char2 = self.grid[r2][c2]
                    if char2 and char2.get('hash') == char1.get('hash'):
                        self._add_win('2_KIND', char1['hash'], SCORE_MAP['NORMAL_WIN_2_KIND'], [(r1, c1), (r2, c2)], 'normal-win')
                        processed_in_pass.add(coord1_key)
                        processed_in_pass.add(coord2_key)
                        break
        
    def _apply_picked_character_bonus(self):
        bonus_info = {"score": 0, "type": None, "text": ''}
        if not self.picked_hash: return bonus_info

        picked_wins = [win for win in self.base_wins if win.get('hash') == self.picked_hash]
        if picked_wins:
            highest_picked_win = max(picked_wins, key=lambda w: w['score'])
            multiplier = 1
            win_type = highest_picked_win['type']
            if win_type == 'BIG_JACKPOT': multiplier = SCORE_MAP['PICKED_MULTIPLIER_BIG_JACKPOT']
            elif win_type == '3_LINE': multiplier = SCORE_MAP['PICKED_MULTIPLIER_3_LINE']
            elif win_type == '3_SCATTER': multiplier = SCORE_MAP['PICKED_MULTIPLIER_3_SCATTER']
            elif win_type == '2_KIND': multiplier = SCORE_MAP['PICKED_MULTIPLIER_2_KIND']
            
            bonus_info['score'] = highest_picked_win['score'] * (multiplier - 1)
            bonus_info['text'] = f"PICK x{multiplier}"
        else:
            count = sum(1 for r, c in self.all_coords if self.grid[r][c] and self.grid[r][c].get('hash') == self.picked_hash)
            if count == 3: bonus_info = {"score": SCORE_MAP['PICKED_BONUS_3_SCATTER'], "type": 'PICKED_BONUS_3_SCATTER'}
            elif count == 2: bonus_info = {"score": SCORE_MAP['PICKED_BONUS_2_SCATTER'], "type": 'PICKED_BONUS_2_SCATTER'}
            elif count == 1: bonus_info = {"score": SCORE_MAP['PICKED_BONUS_ONE_SHOW'], "type": 'PICKED_BONUS_ONE_SHOW'}
            elif count == 0 and not self.was_free_spin: bonus_info = {"score": SCORE_MAP['PICKED_PENALTY_NO_SHOW'], "type": 'PICKED_PENALTY_NO_SHOW'}
            
            if bonus_info.get("type"):
                bonus_info["text"] = WIN_TYPE_NAMES.get(bonus_info["type"], '')
        return bonus_info

    def _promote_center_jackpot_if_needed(self):
        center = self._get_grid_cell(1, 1)
        if not center or not center.get('hash'):
            return

        target_hash = center['hash']
        row_coords = [(1, 0), (1, 1), (1, 2)]
        col_coords = [(0, 1), (1, 1), (2, 1)]

        row_match = all(self._coord_matches_hash(coord, target_hash) for coord in row_coords)
        col_match = all(self._coord_matches_hash(coord, target_hash) for coord in col_coords)

        if self.highest_win_type == 'jackpot':
            if row_match or col_match:
                self.jackpot_character = center
            return

        if not row_match and not col_match:
            return

        jackpot_coords = row_coords if row_match else col_coords
        coord_keys = {f"{r},{c}" for r, c in jackpot_coords}

        # Loại bỏ các chiến thắng trước đó dùng chung tọa độ (ví dụ TRIPLE) để nâng cấp thành JACKPOT
        filtered_base = []
        filtered_groups = []
        for win, group in zip(self.base_wins, self.winning_groups):
            if set(group['coords']) == coord_keys:
                continue
            filtered_base.append(win)
            filtered_groups.append(group)

        self.base_wins = filtered_base
        self.winning_groups = filtered_groups

        for key in coord_keys:
            self.processed_coords.discard(key)

        self.base_wins.append({
            "type": "BIG_JACKPOT",
            "hash": target_hash,
            "score": SCORE_MAP['NORMAL_WIN_BIG_JACKPOT']
        })
        self.winning_groups.append({"winLevel": "jackpot", "coords": list(coord_keys)})
        self.processed_coords.update(coord_keys)
        self.highest_win_type = 'jackpot'
        self.jackpot_character = center

    def _coord_matches_hash(self, coord, hash_value):
        r, c = coord
        cell = self._get_grid_cell(r, c)
        return bool(cell and cell.get('hash') == hash_value)

    def _get_grid_cell(self, row, column):
        if 0 <= row < len(self.grid) and 0 <= column < len(self.grid[row]):
            return self.grid[row][column]
        return None
