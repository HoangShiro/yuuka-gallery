from __future__ import annotations

from dataclasses import dataclass, field
from typing import Dict, Optional, List, Any

from .logic.game_handler import GameHandler


@dataclass
class PvPMatch:
    room_id: str
    slot_id: str
    is_mobile: bool
    max_spins: int
    handlers: Dict[str, GameHandler] = field(default_factory=dict)
    turn_order: List[str] = field(default_factory=list)
    active_player: Optional[str] = None
    status: str = "waiting"  # waiting | in_progress | finished
    winner: Optional[str] = None
    board_snapshot: Optional[Dict[str, Any]] = None
    archived_states: Dict[str, Dict[str, Any]] = field(default_factory=dict)


class SlotMachinePlugin:
    """
    Backend cho plugin Slot Machine.
    Quản lý chế độ chơi đơn (single) và PvP thông qua GameService.
    """

    def __init__(self, core_api):
        self.core_api = core_api
        self.GAME_ID = "slot-machine"
        self.single_sessions: Dict[str, GameHandler] = {}
        self.pvp_matches: Dict[str, PvPMatch] = {}
        self.PVP_SPIN_LIMIT = 10
        self.pvp_slots = {
            "room-1": {"room_id": f"{self.GAME_ID}:pvp-1", "label": "Room 1"},
            "room-2": {"room_id": f"{self.GAME_ID}:pvp-2", "label": "Room 2"},
            "room-3": {"room_id": f"{self.GAME_ID}:pvp-3", "label": "Room 3"},
        }
        print(f"[Plugin:{self.GAME_ID}] Backend initialized.")

    def register_services(self):
        """Đăng ký service xử lý hành động game với CoreAPI."""
        action_service = f"game:{self.GAME_ID}:action"
        serialize_service = f"game:{self.GAME_ID}:serialize_state"
        self.core_api.register_service(action_service, self._handle_game_action)
        self.core_api.register_service(serialize_service, self._serialize_state)

    def get_blueprint(self):
        """Plugin không cần route API riêng."""
        return None, None

    # ------------------------------------------------------------------ #
    # Core dispatcher
    # ------------------------------------------------------------------ #

    def _handle_game_action(self, current_state, player_hash, action_data):
        action_type = action_data.get("type")
        mode = action_data.get("mode") or (current_state or {}).get("mode") or "single"

        if action_type == "get_lobby":
            rooms = self._build_lobby_state()
            return {"player_message": {"type": "lobby_state", "rooms": rooms}}

        if action_type == "request_pvp_slot":
            return {"player_message": self._handle_request_pvp_slot(player_hash, action_data)}

        if action_type == "leave_match" and mode == "pvp":
            return self._handle_pvp_leave(current_state, player_hash, action_data)

        if action_type == "start_game":
            if mode == "pvp":
                return self._start_pvp_game(current_state, player_hash, action_data)
            return self._start_single_game(current_state, player_hash, action_data)

        if mode == "pvp":
            if action_type == "spin":
                return self._handle_pvp_spin(current_state, player_hash, action_data)
            if action_type == "pick_card":
                return self._handle_pvp_pick(current_state, player_hash, action_data)
            if action_type == "reset_match":
                return self._handle_pvp_reset(current_state, player_hash, action_data)
            return {"player_message": {"type": "error", "message": "Unsupported PvP action."}}

        # Single mode fallback
        handler = self.single_sessions.get(player_hash)
        if not handler:
            return {"player_message": {"type": "error", "message": "Game session not found."}}

        if action_type == "spin":
            result = handler.handle_spin(action_data)
            if result:
                return {"player_message": result}
            return None

        if action_type == "pick_card":
            result = handler.handle_pick_card(action_data)
            if result:
                return {"player_message": result}
            return None

        return {"player_message": {"type": "error", "message": f"Unknown action '{action_type}'."}}

    # ------------------------------------------------------------------ #
    # Single mode helpers
    # ------------------------------------------------------------------ #

    def _start_single_game(self, current_state, player_hash, action_data):
        handler = GameHandler(self.core_api, player_hash)
        self.single_sessions[player_hash] = handler
        initial = handler.start_game(action_data)
        new_state = {
            "mode": "single",
            "player_hash": player_hash,
            "room_id": action_data.get("room_id"),
        }
        return {"new_state": new_state, "player_message": initial}

    # ------------------------------------------------------------------ #
    # PvP helpers
    # ------------------------------------------------------------------ #

    def _handle_request_pvp_slot(self, player_hash, action_data):
        slot_id = action_data.get("slot_id")
        if slot_id not in self.pvp_slots:
            return {"type": "pvp_error", "message": "Room slot not found."}

        slot = self.pvp_slots[slot_id]
        room_id = slot["room_id"]
        match = self.pvp_matches.get(room_id)
        should_create = match is None

        if match and len(match.handlers) >= 2:
            return {"type": "pvp_error", "message": "Room is full."}

        summary = self._build_match_summary(match) if match else self._empty_match_summary(room_id, slot_id)
        return {
            "type": "pvp_entry",
            "roomId": room_id,
            "slotId": slot_id,
            "shouldCreate": should_create,
            "maxSpins": self.PVP_SPIN_LIMIT,
            "matchSummary": summary,
        }

    def _start_pvp_game(self, current_state, player_hash, action_data):
        room_id = action_data.get("room_id")
        slot_id = action_data.get("slot_id")
        if not room_id or not slot_id:
            return {"player_message": {"type": "error", "message": "Missing PvP room metadata."}}

        is_mobile = bool(action_data.get("is_mobile", False))
        match = self._get_or_create_match(room_id, slot_id, is_mobile)

        handler = match.handlers.get(player_hash)
        archived_state = match.archived_states.pop(player_hash, None)
        created_now = False
        if not handler:
            created_now = True
            handler = GameHandler(self.core_api, player_hash)
            match.handlers[player_hash] = handler
            if player_hash not in match.turn_order:
                match.turn_order.append(player_hash)

        initial_state_payload = None
        if archived_state:
            board_snapshot = match.board_snapshot or archived_state.get("board")
            if board_snapshot:
                handler.apply_board_snapshot(board_snapshot)
                match.board_snapshot = board_snapshot
            else:
                start_payload = {"is_mobile": match.is_mobile or is_mobile}
                handler.start_game(start_payload)
                match.board_snapshot = handler.create_board_snapshot()
                match.is_mobile = handler.state.is_mobile
            handler.import_session_state(archived_state.get("session"))
            handler.state.is_mobile = match.is_mobile
            handler.state.is_spinning = False
            initial_state_payload = handler.state.to_dict()
            if archived_state.get("was_active") and (match.active_player not in match.handlers or match.active_player is None):
                match.active_player = player_hash
        elif created_now:
            if match.board_snapshot is None:
                start_payload = dict(action_data)
                start_payload["is_mobile"] = is_mobile
                initial_message = handler.start_game(start_payload)
                match.board_snapshot = handler.create_board_snapshot()
                match.is_mobile = handler.state.is_mobile
                match.active_player = player_hash
                match.status = "waiting"
                initial_state_payload = initial_message["data"]
            else:
                start_payload = {"is_mobile": match.is_mobile}
                handler.start_game(start_payload)
                handler.apply_board_snapshot(match.board_snapshot)
                initial_state_payload = handler.state.to_dict()

            # Sync board to existing players
            self._apply_board_to_others(match, match.board_snapshot, exclude=player_hash)
        else:
            # Player reconnecting: rebuild from current board snapshot
            if match.board_snapshot:
                handler.apply_board_snapshot(match.board_snapshot)
            initial_state_payload = handler.state.to_dict()

        if len(match.handlers) >= 2 and match.status != "finished":
            match.status = "in_progress"
            if match.active_player not in match.handlers:
                match.active_player = player_hash

        summary = self._build_match_summary(match)
        new_state = self._build_room_state(match, summary)

        player_message = {
            "type": "initial_state",
            "mode": "pvp",
            "data": initial_state_payload,
            "matchSummary": summary,
        }

        broadcast_message = {"type": "match_state", "matchSummary": summary}
        return {"new_state": new_state, "player_message": player_message, "broadcast_message": broadcast_message}

    def _handle_pvp_spin(self, current_state, player_hash, action_data):
        room_id = current_state.get("room_id") or action_data.get("room_id")
        match = self.pvp_matches.get(room_id or "")
        if not match:
            return {"player_message": {"type": "error", "message": "Match not found."}}

        handler = match.handlers.get(player_hash)
        if not handler:
            return {"player_message": {"type": "error", "message": "Player not part of this match."}}

        if match.status == "finished":
            return {"player_message": {"type": "error", "message": "Match already finished. Please reset."}}

        if match.active_player and match.active_player != player_hash:
            return {"player_message": {"type": "error", "message": "Not your turn."}}

        auto_credit = bool(action_data.get("auto_credit"))

        if handler.state.session_spins >= match.max_spins and not auto_credit:
            return {"player_message": {"type": "error", "message": "No spins remaining."}}

        result = handler.handle_spin(action_data)
        if not result:
            return None

        # Update shared board and sync to opponents
        match.board_snapshot = handler.create_board_snapshot()
        self._apply_board_to_others(match, match.board_snapshot, exclude=player_hash)

        # Determine next turn / match status
        has_pending_respin = handler.state.auto_spin_credits > 0
        has_pending_reverse_spin = handler.state.reverse_spin_credits > 0
        any_pending_auto = any(
            (h.state.auto_spin_credits > 0) or (h.state.reverse_spin_credits > 0)
            for h in match.handlers.values()
        )
        finished = (
            len(match.handlers) >= 2
            and all(h.state.session_spins >= match.max_spins for h in match.handlers.values())
            and not any_pending_auto
        )

        if finished:
            match.status = "finished"
            scores = {ph: h.state.session_score for ph, h in match.handlers.items()}
            if scores:
                max_score = max(scores.values())
                winners = [ph for ph, sc in scores.items() if sc == max_score]
                match.winner = winners[0] if len(winners) == 1 else None
            match.active_player = None
        else:
            match.winner = None
            if has_pending_respin or has_pending_reverse_spin:
                match.active_player = player_hash
            else:
                self._advance_turn(match, current_player=player_hash)
            match.status = "in_progress"

        summary = self._build_match_summary(match)
        result["data"]["mode"] = "pvp"
        result["data"]["playerHash"] = player_hash
        result["data"]["matchSummary"] = summary
        result["data"]["pendingRespin"] = has_pending_respin
        result["data"]["pendingReverseSpin"] = has_pending_reverse_spin

        new_state = self._build_room_state(match, summary)
        return {"new_state": new_state, "broadcast_message": result}

    def _handle_pvp_pick(self, current_state, player_hash, action_data):
        room_id = current_state.get("room_id") or action_data.get("room_id")
        match = self.pvp_matches.get(room_id or "")
        if not match:
            return {"player_message": {"type": "error", "message": "Match not found."}}

        handler = match.handlers.get(player_hash)
        if not handler:
            return {"player_message": {"type": "error", "message": "Player not part of this match."}}

        if match.active_player and match.active_player != player_hash:
            return {"player_message": {"type": "error", "message": "Cannot pick cards outside your turn."}}

        result = handler.handle_pick_card(action_data)
        if not result:
            return None

        match.board_snapshot = handler.create_board_snapshot()
        self._apply_board_to_others(match, match.board_snapshot, exclude=player_hash)

        summary = self._build_match_summary(match)
        result["data"]["mode"] = "pvp"
        result["data"]["playerHash"] = player_hash
        result["data"]["matchSummary"] = summary

        new_state = self._build_room_state(match, summary)
        return {"new_state": new_state, "broadcast_message": result}

    def _handle_pvp_reset(self, current_state, player_hash, action_data):
        room_id = current_state.get("room_id") or action_data.get("room_id")
        match = self.pvp_matches.get(room_id or "")
        if not match or player_hash not in match.handlers:
            return {"player_message": {"type": "error", "message": "Match not found."}}

        if not match.handlers:
            return {"player_message": {"type": "error", "message": "No players in match."}}

        match.archived_states.clear()

        primary_hash = next((ph for ph in match.turn_order if ph in match.handlers), None)
        if not primary_hash:
            return {"player_message": {"type": "error", "message": "Unable to reset match."}}

        primary_handler = match.handlers[primary_hash]
        start_payload = {"is_mobile": match.is_mobile}
        primary_initial = primary_handler.start_game(start_payload)
        match.board_snapshot = primary_handler.create_board_snapshot()

        initial_states = {primary_hash: primary_initial["data"]}

        for opponent_hash, opponent_handler in match.handlers.items():
            if opponent_hash == primary_hash:
                continue
            opponent_handler.start_game(start_payload)
            opponent_handler.apply_board_snapshot(match.board_snapshot)
            initial_states[opponent_hash] = opponent_handler.state.to_dict()

        match.status = "in_progress" if len(match.handlers) >= 2 else "waiting"
        match.winner = None
        match.active_player = primary_hash

        summary = self._build_match_summary(match)
        new_state = self._build_room_state(match, summary)

        broadcast_message = {
            "type": "match_reset",
            "mode": "pvp",
            "matchSummary": summary,
            "initialStates": initial_states,
        }
        return {"new_state": new_state, "broadcast_message": broadcast_message}

    def _handle_pvp_leave(self, current_state, player_hash, action_data):
        room_id = current_state.get("room_id") or action_data.get("room_id")
        if not room_id:
            return {"player_message": {"type": "leave_ack", "message": "Left match."}}

        match = self.pvp_matches.get(room_id)
        if not match or player_hash not in match.handlers:
            return {"player_message": {"type": "leave_ack", "message": "Left match."}}

        handler = match.handlers.get(player_hash)
        if handler:
            board_snapshot = handler.create_board_snapshot()
            match.archived_states[player_hash] = {
                "session": handler.export_session_state(),
                "board": board_snapshot,
                "was_active": match.active_player == player_hash,
            }
            if board_snapshot:
                match.board_snapshot = board_snapshot

        match.handlers.pop(player_hash, None)

        if not match.handlers:
            self.pvp_matches.pop(room_id, None)
            new_state = {"mode": "pvp", "slot_id": match.slot_id, "room_id": room_id, "match_summary": None}
            return {"new_state": new_state, "broadcast_message": {"type": "match_state", "matchSummary": None}}

        if match.active_player == player_hash:
            self._advance_turn(match, current_player=player_hash)

        match.status = "waiting" if len(match.handlers) == 1 else match.status
        if match.status != "finished":
            match.winner = None

        summary = self._build_match_summary(match)
        new_state = self._build_room_state(match, summary)
        broadcast_message = {"type": "match_state", "matchSummary": summary}
        return {"new_state": new_state, "broadcast_message": broadcast_message}

    # ------------------------------------------------------------------ #
    # Match utilities
    # ------------------------------------------------------------------ #

    def _get_or_create_match(self, room_id: str, slot_id: str, is_mobile: bool) -> PvPMatch:
        match = self.pvp_matches.get(room_id)
        if match:
            return match

        match = PvPMatch(
            room_id=room_id,
            slot_id=slot_id,
            is_mobile=is_mobile,
            max_spins=self.PVP_SPIN_LIMIT,
        )
        self.pvp_matches[room_id] = match
        return match

    def _apply_board_to_others(self, match: PvPMatch, snapshot: Optional[Dict[str, Any]], exclude: Optional[str] = None):
        if not snapshot:
            return
        for ph, handler in match.handlers.items():
            if ph == exclude:
                continue
            handler.apply_board_snapshot(snapshot)

    def _advance_turn(self, match: PvPMatch, current_player: Optional[str]):
        if not match.handlers:
            match.active_player = None
            return

        ordered_players = [ph for ph in match.turn_order if ph in match.handlers]
        if not ordered_players:
            match.active_player = None
            return

        if current_player not in ordered_players:
            match.active_player = ordered_players[0]
            return

        current_idx = ordered_players.index(current_player)
        for offset in range(1, len(ordered_players) + 1):
            candidate = ordered_players[(current_idx + offset) % len(ordered_players)]
            handler = match.handlers.get(candidate)
            if handler and handler.state.session_spins < match.max_spins:
                match.active_player = candidate
                return

        match.active_player = None

    # ------------------------------------------------------------------ #
    # State serialization & lobby helpers
    # ------------------------------------------------------------------ #

    def _build_match_summary(self, match: Optional[PvPMatch]):
        if not match:
            return None

        players = []
        for ph in match.turn_order:
            handler = match.handlers.get(ph)
            if not handler:
                continue
            summary = handler.get_player_summary()
            remaining_turns = max(0, match.max_spins - summary["session_spins"])
            bonus_spins = handler.state.auto_spin_credits if handler.state.auto_spin_credits > 0 else 0
            players.append({
                "hash": ph,
                "score": summary["session_score"],
                "spinsUsed": summary["session_spins"],
                "spinsLeft": remaining_turns + bonus_spins,
                "freeSpins": summary["free_spins"],
                "jackpots": summary["session_jackpots"],
            })

        return {
            "roomId": match.room_id,
            "slotId": match.slot_id,
            "status": match.status,
            "activePlayer": match.active_player,
            "winner": match.winner,
            "maxSpins": match.max_spins,
            "players": players,
        }

    def _empty_match_summary(self, room_id: str, slot_id: str):
        return {
            "roomId": room_id,
            "slotId": slot_id,
            "status": "waiting",
            "activePlayer": None,
            "winner": None,
            "maxSpins": self.PVP_SPIN_LIMIT,
            "players": [],
        }

    def _build_room_state(self, match: PvPMatch, summary: Optional[Dict[str, Any]]):
        return {
            "mode": "pvp",
            "slot_id": match.slot_id,
            "room_id": match.room_id,
            "match_summary": summary,
        }

    def _build_lobby_state(self):
        lobby = []
        for slot_id, slot in self.pvp_slots.items():
            room_id = slot["room_id"]
            match = self.pvp_matches.get(room_id)
            summary = self._build_match_summary(match) if match else self._empty_match_summary(room_id, slot_id)
            lobby.append({
                "slotId": slot_id,
                "roomId": room_id,
                "label": slot["label"],
                "summary": summary,
            })
        return lobby

    def _serialize_state(self, state):
        if not state:
            return {}
        safe_state = dict(state)
        summary = safe_state.get("match_summary")
        if summary and isinstance(summary, dict):
            safe_state["match_summary"] = {
                "status": summary.get("status"),
                "activePlayer": summary.get("activePlayer"),
                "winner": summary.get("winner"),
                "players": [
                    {"hash": p.get("hash"), "score": p.get("score"), "spinsUsed": p.get("spinsUsed")}
                    for p in summary.get("players", [])
                ],
                "maxSpins": summary.get("maxSpins"),
            }
        return safe_state
