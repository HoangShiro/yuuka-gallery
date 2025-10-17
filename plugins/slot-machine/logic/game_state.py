# --- MODIFIED FILE: plugins/slot-machine/logic/game_state.py ---
import random
from dataclasses import dataclass, field
from typing import List, Dict, Any
# Yuuka: new architecture v2.1 - Import constants to send to frontend
from .constants import GAME_CONFIG, SPECIAL_CARD_CONFIGS

@dataclass
class SlotMachineState:
    """Lưu trữ trạng thái của một ván game Slot Machine."""
    # Trạng thái người chơi
    user_hash: str
    is_mobile: bool = False
    
    # Trạng thái game
    character_pool: List[Dict[str, Any]] = field(default_factory=list)
    reel_characters: List[List[Dict[str, Any]]] = field(default_factory=list)
    session_special_map: Dict[str, Any] = field(default_factory=dict)
    
    # Chỉ số session
    is_spinning: bool = False
    picked_character_hash: str = None
    session_spins: int = 0
    session_score: int = 0
    session_jackpots: int = 0
    free_spins: int = 5
    auto_spin_credits: int = 0
    spin_direction: int = 1
    reverse_spin_credits: int = 0
    reverse_spin_active: bool = False

    # Chỉ số persistent (sẽ được load từ bên ngoài)
    total_spins: int = 0
    high_score: int = 0
    total_jackpots: int = 0
    
    def to_dict(self):
        """Chuyển đổi trạng thái sang dạng dict để gửi qua WebSocket."""
        return {
            "isMobile": self.is_mobile,
            "reelCharacters": self.reel_characters,
            "sessionSpecialMap": {k: v for k, v in self.session_special_map.items()},
            "stats": self.get_stats_dict(),
            "pickedCharacterHash": self.picked_character_hash,
            "isSpinning": self.is_spinning,
            "freeSpins": self.free_spins,
            "sessionScore": self.session_score,
            "spinDirection": self.spin_direction,
            "reverseSpinCredits": self.reverse_spin_credits,
            # Yuuka: new architecture v2.1 - Send config to frontend
            "gameConfig": GAME_CONFIG,
            "specialCardConfigs": SPECIAL_CARD_CONFIGS,
        }

    def get_stats_dict(self):
        """Lấy dict chứa các chỉ số để hiển thị."""
        return {
            "sessionScore": self.session_score,
            "highScore": self.high_score,
            "sessionJackpots": self.session_jackpots,
            "totalJackpots": self.total_jackpots,
            "sessionSpins": self.session_spins,
            "totalSpins": self.total_spins,
        }
