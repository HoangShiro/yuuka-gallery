# --- MODIFIED FILE: plugins/slot-machine/logic/game_handler.py ---
import random
import copy
from .game_state import SlotMachineState
from .reel_manager import ReelManager
from .result_processor import ResultProcessor
from .constants import GAME_CONFIG

class GameHandler:
    """Xử lý toàn bộ logic cho một ván game, được gọi bởi GameService."""
    def __init__(self, core_api, user_hash):
        self.core_api = core_api
        self.user_hash = user_hash
        self.state = SlotMachineState(user_hash=user_hash)
        self.STATS_FILENAME = 'slot_machine_stats.json'
        
    def start_game(self, data):
        """Khởi tạo một ván game mới."""
        # Reset lại các chỉ số session trước khi bắt đầu ván mới
        self.reset_session_stats()
        char_list = self.core_api.get_all_characters_list()

        blacklist_hashes = set()
        try:
            lists = self.core_api.data_manager.load_user_data(
                "core_lists.json",
                self.user_hash,
                default_value={"favourites": [], "blacklist": []},
                obfuscated=True,
            )
            if isinstance(lists, dict):
                blacklist_hashes = set(lists.get("blacklist", []))
        except Exception:
            try:
                list_service_data = self.core_api.call_service("character-list:get_lists", player_hash=self.user_hash)
                if isinstance(list_service_data, dict):
                    blacklist_hashes = set(list_service_data.get("blacklist", []))
            except Exception:
                blacklist_hashes = set()

        self.state.character_pool = [c for c in char_list if c['hash'] not in blacklist_hashes]

        self.state.is_mobile = data.get("is_mobile", False)

        if len(self.state.character_pool) < GAME_CONFIG["MIN_CHARS_REQUIRED"]:
            return {"error": f"Cần ít nhất {GAME_CONFIG['MIN_CHARS_REQUIRED']} nhân vật."}

        reel_config = {
            "is_mobile": self.state.is_mobile,
            "reel_count": GAME_CONFIG["MOBILE_COLUMN_COUNT"] if self.state.is_mobile else GAME_CONFIG["DESKTOP_ROW_COUNT"],
            "symbols_per_reel": GAME_CONFIG["MOBILE_SYMBOLS_PER_COLUMN"] if self.state.is_mobile else GAME_CONFIG["DESKTOP_SYMBOLS_PER_ROW"],
        }
        reel_manager = ReelManager(self.state.character_pool, reel_config)
        self.state.reel_characters = reel_manager.generate_all_reels()
        self.state.session_special_map = reel_manager.assign_session_special_cards()

        self._load_stats()
        
        return {"type": "initial_state", "data": self.state.to_dict()}
        

    def handle_spin(self, data):
        if self.state.is_spinning:
            return None

        auto_credit = data.get('auto_credit', False)
        demo_mode = bool(data.get("demo_mode", False))
        mode = data.get("mode")
        session_score_for_penalty = self.state.session_score

        if demo_mode:
            cost_result = {"can_spin": True, "points_to_use": 0, "free_spins_to_use": 0, "was_free_spin": False}
            preserved_values = {
                "session_score": self.state.session_score,
                "free_spins": self.state.free_spins,
                "auto_spin_credits": self.state.auto_spin_credits,
                "reverse_spin_credits": self.state.reverse_spin_credits,
                "session_jackpots": self.state.session_jackpots,
                "total_jackpots": self.state.total_jackpots,
                "session_spins": self.state.session_spins,
                "total_spins": self.state.total_spins,
                "high_score": self.state.high_score,
                "spin_direction": self.state.spin_direction,
                "reverse_spin_active": self.state.reverse_spin_active,
            }
        else:
            if (
                mode == "pvp"
                and not auto_credit
                and self.state.session_score <= 0
                and self.state.free_spins <= 0
                and self.state.auto_spin_credits <= 0
            ):
                self.state.free_spins += GAME_CONFIG["FREE_SPINS_ON_EMPTY"]

            cost_result = self._calculate_spin_cost(auto_credit)
            if not cost_result['can_spin']:
                return None
            preserved_values = None

        spin_direction_used = self.state.spin_direction
        self.state.is_spinning = True
        score_before_spin = self.state.session_score  # Yuuka: Ghi lại điểm trước khi trừ

        if not demo_mode:
            consumes_turn = not auto_credit
            if consumes_turn:
                self.state.session_spins += 1
            self.state.total_spins += 1
            self.state.free_spins -= cost_result['free_spins_to_use']
            self.state.session_score -= cost_result['points_to_use']
            session_score_for_penalty = self.state.session_score

            if (
                self.state.session_score == 0
                and self.state.free_spins == 0
                and cost_result['points_to_use'] > 0
            ):
                self.state.free_spins += GAME_CONFIG["FREE_SPINS_ON_EMPTY"]

        force_jackpot = data.get("force_jackpot", False)
        reel_manager = ReelManager(self.state.character_pool, {
            "is_mobile": self.state.is_mobile,
            "reel_count": len(self.state.reel_characters)
        })
        reel_manager.reel_characters = self.state.reel_characters

        final_results_chars = reel_manager.determine_final_results(force_jackpot)
        final_card_indices = []
        for i, reel in enumerate(self.state.reel_characters):
            char_hash = final_results_chars[i]['hash']
            try:
                final_card_indices.append(next(idx for idx, char in enumerate(reel) if char['hash'] == char_hash))
            except StopIteration:
                final_card_indices.append(0)

        # Yuuka: Bắt đầu xử lý logic special cards
        special_context = reel_manager.process_specials_for_grid(final_card_indices, self.state.session_special_map)
        self._apply_clear_effects(final_card_indices, special_context)

        grid = self._build_result_grid(final_card_indices)
        swaps_applied = self._apply_swap_effects(grid, final_card_indices, special_context)
        if swaps_applied:
            grid = self._build_result_grid(final_card_indices)

            if self.state.is_mobile:
                updated_center_chars = [grid[1][col] for col in range(len(grid[1]))]
            else:
                updated_center_chars = [row[1] for row in grid]

            recalculated_indices = []
            for reel_index, reel in enumerate(self.state.reel_characters):
                target_hash = updated_center_chars[reel_index]['hash']
                try:
                    recalculated_indices.append(next(idx for idx, char in enumerate(reel) if char.get('hash') == target_hash))
                except StopIteration:
                    recalculated_indices.append(final_card_indices[reel_index])

            final_results_chars = updated_center_chars
            final_card_indices = recalculated_indices
            grid = self._build_result_grid(final_card_indices)

        processor = ResultProcessor(
            grid,
            self.state.picked_character_hash,
            cost_result['was_free_spin'],
            special_context,
            session_score_for_penalty
        )
        outcome = processor.calculate()
        reverse_spin_count = outcome.get('reverseSpinCount', 0)
        next_spin_direction = self._finalize_reverse_spin(reverse_spin_count, not demo_mode)

        if not demo_mode:
            self.state.session_score += outcome['totalScore']
            self.state.session_score = max(0, self.state.session_score)
            self.state.free_spins += outcome['freeSpinsAwarded']
            self.state.auto_spin_credits += outcome['respinCount']

            if outcome['highestWinType'] == 'jackpot':
                self.state.session_jackpots += 1
                self.state.total_jackpots += 1

            if self.state.session_score > self.state.high_score:
                self.state.high_score = self.state.session_score

            self._save_stats()
        else:
            # Không đụng vào stats hoặc nguồn lực của người chơi khi demo
            self.state.session_score = preserved_values["session_score"]
            self.state.free_spins = preserved_values["free_spins"]
            self.state.auto_spin_credits = preserved_values["auto_spin_credits"]
            self.state.reverse_spin_credits = preserved_values["reverse_spin_credits"]
            self.state.session_jackpots = preserved_values["session_jackpots"]
            self.state.total_jackpots = preserved_values["total_jackpots"]
            self.state.session_spins = preserved_values["session_spins"]
            self.state.total_spins = preserved_values["total_spins"]
            self.state.high_score = preserved_values["high_score"]
            self.state.spin_direction = preserved_values["spin_direction"]
            self.state.reverse_spin_active = preserved_values["reverse_spin_active"]

        self.state.is_spinning = False
        picked_before_spin = self.state.picked_character_hash
        self.state.picked_character_hash = None
        next_spin_direction = self.state.spin_direction
        pending_respin = self.state.auto_spin_credits > 0
        pending_reverse_spin = self.state.reverse_spin_credits > 0
        session_special_map = {k: v for k, v in self.state.session_special_map.items()}

        return {
            "type": "spin_result",
            "data": {
                "finalResults": final_results_chars,
                "finalCardIndices": final_card_indices,
                "outcome": outcome,
                "newState": self.state.get_stats_dict(),
                "freeSpins": self.state.free_spins,
                "scoreBefore": score_before_spin,
                "sessionScore": self.state.session_score,
                "pickedCharacterHash": picked_before_spin,
                "reelCharacters": self.state.reel_characters,
                "sessionSpecialMap": session_special_map,
                "spinDirection": spin_direction_used,
                "nextSpinDirection": next_spin_direction,
                "pendingRespin": pending_respin,
                "pendingReverseSpin": pending_reverse_spin,
                "reverseSpinCredits": self.state.reverse_spin_credits,
                "demoMode": demo_mode
            }
        }

    def handle_pick_card(self, data):
        """Xử lý chọn thẻ."""
        if self.state.is_spinning: return None
        new_hash = data.get("hash")
        if self.state.picked_character_hash == new_hash:
            self.state.picked_character_hash = None
        else:
            self.state.picked_character_hash = new_hash
        
        return {"type": "pick_update", "data": {"pickedCharacterHash": self.state.picked_character_hash}}
        
    def _calculate_spin_cost(self, auto_credit):
        result = {"can_spin": False, "points_to_use": 0, "free_spins_to_use": 0, "was_free_spin": False}
        if auto_credit:
            if self.state.reverse_spin_credits > 0:
                self.state.reverse_spin_credits -= 1
                self.state.reverse_spin_active = True
                self.state.spin_direction *= -1
                result.update({"can_spin": True, "was_free_spin": True, "reverse_auto": True})
                return result
            if self.state.auto_spin_credits > 0:
                self.state.auto_spin_credits -= 1
                result.update({"can_spin": True, "was_free_spin": True})
                return result
        
        required_free_spins = 2 if self.state.picked_character_hash else 1
        if self.state.free_spins >= required_free_spins:
            result.update({"can_spin": True, "was_free_spin": True, "free_spins_to_use": required_free_spins})
        elif self.state.session_score >= GAME_CONFIG['SPIN_COST']:
            result.update({"can_spin": True, "points_to_use": GAME_CONFIG['SPIN_COST']})
            
        return result

    def _build_result_grid(self, final_card_indices):
        grid = [[None for _ in range(3)] for _ in range(3)]
        reel_count = len(self.state.reel_characters)
        for i in range(reel_count):
            reel = self.state.reel_characters[i]
            center_idx = final_card_indices[i]
            reel_len = len(reel)
            indices = [(center_idx - 1 + reel_len) % reel_len, center_idx, (center_idx + 1) % reel_len]
            
            for j in range(3):
                r = j if self.state.is_mobile else i
                c = i if self.state.is_mobile else j
                grid[r][c] = reel[indices[j]]
        return grid

    # --- Yuuka: Ported Special Card Logic ---

    def _apply_clear_effects(self, final_card_indices, special_context):
        summary = special_context.get("summary", {})
        if not summary or not summary.get("clears"): return

        visible_keys = self._collect_visible_session_keys(final_card_indices)
        if not visible_keys: return

        assignments = special_context.get("assignments", {})
        effects_to_move = []
        for grid_key, assignment in assignments.items():
            session_key = assignment.get("sessionKey")
            if not session_key or not session_key in visible_keys: continue
            if assignment.get("effect", {}).get("category") == 'clear': continue
            raw_effect = self.state.session_special_map.get(session_key)
            if not raw_effect: continue
            effects_to_move.append({
                "gridKey": grid_key, "assignment": assignment,
                "sessionKey": session_key, "rawEffect": raw_effect
            })

        if not effects_to_move: return
        
        moved_session_keys = {item['sessionKey'] for item in effects_to_move}
        for item in effects_to_move:
            if item['gridKey'] in assignments: del assignments[item['gridKey']]
            if item['sessionKey'] in self.state.session_special_map: del self.state.session_special_map[item['sessionKey']]

        for key in ['multipliers', 'penalties', 'freeSpins', 'bonusPoints']:
            summary[key] = [e for e in summary.get(key, []) if e.get('__sessionKey') not in moved_session_keys]
        summary['swaps'] = [s for s in summary.get('swaps', []) if s.get('effect', {}).get('__sessionKey') not in moved_session_keys]

        respin_reduction = sum(item['assignment'].get('effect', {}).get('respins', 0) for item in effects_to_move if item['assignment'].get('effect', {}).get('category') == 'respin')
        summary['respins'] = max(0, summary.get('respins', 0) - respin_reduction)

        available_targets = self._collect_available_session_slots(visible_keys)
        random.shuffle(available_targets)
        
        summary.setdefault("clearReassignments", [])
        for item in effects_to_move:
            if available_targets:
                target = available_targets.pop()
                self.state.session_special_map[target['key']] = item['rawEffect']
                summary["clearReassignments"].append({
                    "from": item['sessionKey'], "to": target['key'],
                    "effectId": item['assignment'].get('effect', {}).get('id'), "stuck": False
                })
            else: # No slot, restore
                self.state.session_special_map[item['sessionKey']] = item['rawEffect']
                summary["clearReassignments"].append({
                    "from": item['sessionKey'], "to": item['sessionKey'],
                    "effectId": item['assignment'].get('effect', {}).get('id'), "stuck": True
                })
    
    def _collect_visible_session_keys(self, final_card_indices):
        visible_keys = set()
        for i, reel in enumerate(self.state.reel_characters):
            center_idx = final_card_indices[i]
            reel_len = len(reel)
            indices = [(center_idx - 1 + reel_len) % reel_len, center_idx, (center_idx + 1) % reel_len]
            for char_index in indices:
                visible_keys.add(f"{i},{char_index}")
        return visible_keys

    def _collect_available_session_slots(self, visible_keys):
        slots = []
        for reel_idx, reel in enumerate(self.state.reel_characters):
            for char_idx in range(len(reel)):
                key = f"{reel_idx},{char_idx}"
                if key not in visible_keys and key not in self.state.session_special_map:
                    slots.append({"key": key, "reelIndex": reel_idx, "charIndex": char_idx})
        return slots

    def _apply_swap_effects(self, grid, final_card_indices, special_context):
        swaps = special_context.get("summary", {}).get("swaps")
        if not swaps:
            return False

        executed_swaps = []
        for entry in swaps:
            position = entry.get("position")
            if not position or not grid[position['row']]: continue

            source_cell = self._resolve_grid_cell(position['row'], position['column'], final_card_indices)
            if not source_cell: continue

            swap_mode = entry.get('effect', {}).get('swapMode', 'adjacent')
            target_cell = self._get_row_swap_target(source_cell, final_card_indices) if swap_mode == 'row-any' else self._get_adjacent_swap_target(position, final_card_indices, grid)
            if not target_cell: continue

            source_char = self.state.reel_characters[source_cell['reelIndex']][source_cell['charIndex']]
            target_char = self.state.reel_characters[target_cell['reelIndex']][target_cell['charIndex']]

            self._swap_reel_characters(source_cell, target_cell)
            
            grid[source_cell['row']][source_cell['column']] = target_char
            if target_cell.get('isVisible'):
                grid[target_cell['row']][target_cell['column']] = source_char

            entry['target'] = {"row": target_cell['row'], "column": target_cell['column']} if target_cell.get('isVisible') else None
            entry['displayLabel'] = f"{source_char['name']} <-> {target_char['name']}"
            entry['sourceCell'] = source_cell
            entry['targetCell'] = target_cell
            executed_swaps.append(entry)
        
        special_context["summary"]["swaps"] = executed_swaps
        return bool(executed_swaps)

    def _resolve_grid_cell(self, row, column, final_card_indices):
        reel_index = column if self.state.is_mobile else row
        reel = self.state.reel_characters[reel_index]
        center_index = final_card_indices[reel_index]
        reel_len = len(reel)
        offset = (row if self.state.is_mobile else column) - 1
        char_index = (center_index + offset + reel_len) % reel_len
        return {"reelIndex": reel_index, "charIndex": char_index, "row": row, "column": column}

    def _get_adjacent_swap_target(self, position, final_card_indices, grid):
        candidates = []
        if position['column'] > 0: candidates.append(position['column'] - 1)
        if position['column'] < len(grid[position['row']]) - 1: candidates.append(position['column'] + 1)
        if not candidates: return None
        
        target_column = random.choice(candidates)
        cell = self._resolve_grid_cell(position['row'], target_column, final_card_indices)
        cell['isVisible'] = True
        return cell

    def _get_row_swap_target(self, source_cell, final_card_indices):
        reel = self.state.reel_characters[source_cell['reelIndex']]
        if len(reel) <= 1: return None

        available_indices = [i for i, _ in enumerate(reel) if i != source_cell['charIndex']]
        if not available_indices: return None

        target_char_index = random.choice(available_indices)
        target_cell = {"reelIndex": source_cell['reelIndex'], "charIndex": target_char_index}
        
        placement = self._locate_char_in_grid(target_cell['reelIndex'], target_char_index, final_card_indices)
        if placement:
            target_cell.update(placement)
            target_cell['isVisible'] = True
        else:
            target_cell.update({"row": source_cell['row'], "column": None, "isVisible": False})
        return target_cell

    def _locate_char_in_grid(self, reel_index, char_index, final_card_indices):
        reel = self.state.reel_characters[reel_index]
        center_index = final_card_indices[reel_index]
        reel_len = len(reel)
        offsets = [-1, 0, 1]
        for idx, offset in enumerate(offsets):
            if (center_index + offset + reel_len) % reel_len == char_index:
                return {"row": idx if self.state.is_mobile else reel_index, "column": reel_index if self.state.is_mobile else idx}
        return None

    def _swap_reel_characters(self, cell_a, cell_b):
        reel_a = self.state.reel_characters[cell_a['reelIndex']]
        reel_b = self.state.reel_characters[cell_b['reelIndex']]
        reel_a[cell_a['charIndex']], reel_b[cell_b['charIndex']] = reel_b[cell_b['charIndex']], reel_a[cell_a['charIndex']]

    def _finalize_reverse_spin(self, reverse_spin_count, award_rewards):
        if award_rewards and reverse_spin_count > 0:
            self.state.reverse_spin_credits += reverse_spin_count
        if self.state.reverse_spin_active:
            self.state.spin_direction *= -1
            self.state.reverse_spin_active = False
        return self.state.spin_direction

    # --- End of Ported Logic ---

    def _load_stats(self):
        stats = self.core_api.data_manager.load_user_data(
            self.STATS_FILENAME, self.user_hash, default_value={}
        )
        self.state.total_spins = stats.get('total_spins', 0)
        self.state.high_score = stats.get('high_score', 0)
        self.state.total_jackpots = stats.get('total_jackpots', 0)
    
    def _save_stats(self):
        data_to_save = {
            'total_spins': self.state.total_spins,
            'high_score': self.state.high_score,
            'total_jackpots': self.state.total_jackpots,
        }
        self.core_api.data_manager.save_user_data(
            data_to_save, self.STATS_FILENAME, self.user_hash
        )

    # --- PvP helpers ---

    def create_board_snapshot(self):
        """Capture shared board data so both players see identical reels/specials."""
        return {
            "character_pool": copy.deepcopy(self.state.character_pool),
            "reel_characters": copy.deepcopy(self.state.reel_characters),
            "session_special_map": copy.deepcopy(self.state.session_special_map),
            "picked_character_hash": self.state.picked_character_hash,
            "spin_direction": self.state.spin_direction,
            "reverse_spin_credits": self.state.reverse_spin_credits,
            "reverse_spin_active": self.state.reverse_spin_active,
            "is_mobile": self.state.is_mobile,
        }

    def apply_board_snapshot(self, snapshot):
        """Apply shared board data coming from another player's spin."""
        if not snapshot:
            return

        if "character_pool" in snapshot and snapshot["character_pool"] is not None:
            self.state.character_pool = copy.deepcopy(snapshot["character_pool"])
        if "reel_characters" in snapshot and snapshot["reel_characters"] is not None:
            self.state.reel_characters = copy.deepcopy(snapshot["reel_characters"])
        if "session_special_map" in snapshot and snapshot["session_special_map"] is not None:
            self.state.session_special_map = copy.deepcopy(snapshot["session_special_map"])

        self.state.picked_character_hash = snapshot.get("picked_character_hash")
        self.state.spin_direction = snapshot.get("spin_direction", self.state.spin_direction)
        self.state.reverse_spin_credits = snapshot.get("reverse_spin_credits", self.state.reverse_spin_credits)
        self.state.reverse_spin_active = snapshot.get("reverse_spin_active", False)
        self.state.is_mobile = snapshot.get("is_mobile", self.state.is_mobile)
        self.state.is_spinning = False

    def get_player_summary(self):
        """Expose per-player stats for PvP scoreboard."""
        return {
            "session_score": self.state.session_score,
            "session_spins": self.state.session_spins,
            "session_jackpots": self.state.session_jackpots,
            "free_spins": self.state.free_spins,
            "auto_spin_credits": self.state.auto_spin_credits,
        }

    def export_session_state(self):
        """Capture session-related fields so PvP reconnects can restore progress."""
        return {
            "session_score": self.state.session_score,
            "session_spins": self.state.session_spins,
            "session_jackpots": self.state.session_jackpots,
            "free_spins": self.state.free_spins,
            "auto_spin_credits": self.state.auto_spin_credits,
            "reverse_spin_credits": self.state.reverse_spin_credits,
            "reverse_spin_active": self.state.reverse_spin_active,
            "spin_direction": self.state.spin_direction,
            "picked_character_hash": self.state.picked_character_hash,
            "total_spins": self.state.total_spins,
            "total_jackpots": self.state.total_jackpots,
            "high_score": self.state.high_score,
        }

    def import_session_state(self, snapshot):
        """Restore session fields from a previously exported snapshot."""
        if not snapshot:
            return
        self.state.session_score = snapshot.get("session_score", self.state.session_score)
        self.state.session_spins = snapshot.get("session_spins", self.state.session_spins)
        self.state.session_jackpots = snapshot.get("session_jackpots", self.state.session_jackpots)
        self.state.free_spins = snapshot.get("free_spins", self.state.free_spins)
        self.state.auto_spin_credits = snapshot.get("auto_spin_credits", self.state.auto_spin_credits)
        self.state.reverse_spin_credits = snapshot.get("reverse_spin_credits", self.state.reverse_spin_credits)
        self.state.reverse_spin_active = snapshot.get("reverse_spin_active", False)
        self.state.spin_direction = snapshot.get("spin_direction", self.state.spin_direction)
        self.state.picked_character_hash = snapshot.get("picked_character_hash")
        self.state.total_spins = snapshot.get("total_spins", self.state.total_spins)
        self.state.total_jackpots = snapshot.get("total_jackpots", self.state.total_jackpots)
        self.state.high_score = snapshot.get("high_score", self.state.high_score)
        self.state.is_spinning = False

    def reset_session_stats(self):
        """Reset counters so a PvP rematch starts clean."""
        self.state.session_score = 0
        self.state.session_spins = 0
        self.state.session_jackpots = 0
        self.state.free_spins = 5  # Reset to default starting free spins
        self.state.auto_spin_credits = 0
        self.state.reverse_spin_credits = 0
        self.state.picked_character_hash = None
        self.state.is_spinning = False
        self.state.spin_direction = 1
        self.state.reverse_spin_active = False
