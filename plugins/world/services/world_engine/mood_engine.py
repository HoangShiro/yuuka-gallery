"""
Mood Engine - NPC mood management and transitions.

Handles mood states, transitions, duration, and effects on behavior.
"""

import random
from typing import Dict, List, Optional, Tuple

from .constants_social import (
    MOOD_STATES,
    MOOD_TRANSITIONS,
    MOOD_BEHAVIOR_MODIFIERS,
    MOOD_NATURAL_DECAY_RATE,
    MOOD_MIN_DURATION_TICKS,
)


class MoodEngine:
    """Manages NPC moods and their effects."""
    
    def __init__(self):
        pass
    
    def initialize_mood(self, npc: dict, personality: Optional[dict] = None):
        """Initialize mood for an NPC based on personality."""
        # Default to neutral
        base_mood = "neutral"
        base_intensity = 0.5
        
        # Personality affects starting mood
        if personality:
            neuroticism = personality.get("neuroticism", 0.5)
            extraversion = personality.get("extraversion", 0.5)
            
            # High neuroticism = more likely to start anxious or sad
            if neuroticism > 0.7:
                if random.random() < 0.3:
                    base_mood = "anxious"
                    base_intensity = 0.3 + neuroticism * 0.3
            # High extraversion = more likely to start happy
            elif extraversion > 0.7:
                if random.random() < 0.3:
                    base_mood = "content"
                    base_intensity = 0.4 + extraversion * 0.2
        
        npc["mood"] = {
            "current": base_mood,
            "intensity": base_intensity,
            "cause": "initialization",
            "duration_ticks": 0,
            "modifiers": MOOD_BEHAVIOR_MODIFIERS.get(base_mood, {}).copy(),
        }
    
    def get_current_mood(self, npc: dict) -> dict:
        """Get the current mood state."""
        return npc.get("mood", {
            "current": "neutral",
            "intensity": 0.5,
            "cause": "unknown",
            "duration_ticks": 0,
            "modifiers": {},
        })
    
    def set_mood(
        self,
        npc: dict,
        new_mood: str,
        intensity: float,
        cause: str,
        duration_ticks: int = 10,
    ):
        """Set a new mood for an NPC."""
        # Validate mood
        if new_mood not in MOOD_STATES:
            new_mood = "neutral"
        
        intensity = max(0.0, min(1.0, intensity))
        
        npc["mood"] = {
            "current": new_mood,
            "intensity": intensity,
            "cause": cause,
            "duration_ticks": duration_ticks,
            "modifiers": MOOD_BEHAVIOR_MODIFIERS.get(new_mood, {}).copy(),
        }
    
    def apply_trigger(
        self,
        npc: dict,
        trigger: str,
        magnitude: float = 1.0,
    ) -> Tuple[str, bool]:
        """
        Apply a mood trigger to an NPC.
        
        Args:
            npc: The NPC
            trigger: Trigger type (positive_interaction, conflict, etc.)
            magnitude: Intensity multiplier
        
        Returns:
            (new_mood, changed) tuple
        """
        current = self.get_current_mood(npc)
        current_mood = current.get("current", "neutral")
        
        # Get transition rules for current mood
        transitions = MOOD_TRANSITIONS.get(current_mood, {})
        
        if trigger not in transitions:
            # No transition defined, try to find a fallback
            if trigger in MOOD_TRANSITIONS.get("neutral", {}):
                # Use neutral's transition as fallback
                transitions = MOOD_TRANSITIONS["neutral"]
            else:
                return current_mood, False
        
        new_mood, intensity_change = transitions[trigger]
        
        # Calculate new intensity
        current_intensity = current.get("intensity", 0.5)
        new_intensity = current_intensity + intensity_change * magnitude
        new_intensity = max(0.0, min(1.0, new_intensity))
        
        # Set new mood
        self.set_mood(
            npc,
            new_mood,
            new_intensity,
            cause=trigger,
            duration_ticks=max(5, int(10 * magnitude)),
        )
        
        return new_mood, True
    
    def decay_mood(self, npc: dict, ticks_passed: int = 1):
        """
        Decay mood over time, potentially returning to neutral.
        """
        current = self.get_current_mood(npc)
        
        if current.get("current") == "neutral":
            return
        
        duration = current.get("duration_ticks", 0)
        new_duration = duration - ticks_passed
        
        if new_duration <= 0:
            # Duration expired, start decaying intensity
            intensity = current.get("intensity", 0.5)
            new_intensity = intensity - MOOD_NATURAL_DECAY_RATE * ticks_passed
            
            if new_intensity <= 0.1:
                # Return to neutral
                self.set_mood(npc, "neutral", 0.5, cause="time_passes", duration_ticks=0)
            else:
                # Reduce intensity but keep mood
                npc["mood"]["intensity"] = new_intensity
                npc["mood"]["duration_ticks"] = 0
        else:
            # Still in duration, just decrement
            npc["mood"]["duration_ticks"] = new_duration
    
    def get_behavior_modifier(self, npc: dict, modifier_name: str) -> float:
        """
        Get a specific behavior modifier from current mood.
        
        Returns 1.0 if modifier not found or no mood.
        """
        mood = self.get_current_mood(npc)
        modifiers = mood.get("modifiers", {})
        return modifiers.get(modifier_name, 1.0)
    
    def get_all_modifiers(self, npc: dict) -> Dict[str, float]:
        """Get all behavior modifiers from current mood."""
        mood = self.get_current_mood(npc)
        return mood.get("modifiers", {}).copy()
    
    def is_positive_mood(self, npc: dict) -> bool:
        """Check if NPC is in a positive mood."""
        mood = self.get_current_mood(npc)
        positive_moods = {"ecstatic", "happy", "content", "excited", "romantic"}
        return mood.get("current") in positive_moods
    
    def is_negative_mood(self, npc: dict) -> bool:
        """Check if NPC is in a negative mood."""
        mood = self.get_current_mood(npc)
        negative_moods = {"sad", "angry", "anxious", "heartbroken", "vengeful"}
        return mood.get("current") in negative_moods
    
    def is_socially_available(self, npc: dict) -> bool:
        """Check if NPC is in a mood that allows social interaction."""
        mood = self.get_current_mood(npc)
        current = mood.get("current", "neutral")
        
        # These moods reduce social availability
        low_social_moods = {"heartbroken", "vengeful", "anxious"}
        
        if current in low_social_moods:
            # Check intensity - low intensity means they might still socialize
            intensity = mood.get("intensity", 0.5)
            return intensity < 0.7
        
        return True
    
    def get_social_eagerness(self, npc: dict) -> float:
        """
        Get how eager the NPC is to socialize based on mood.
        
        Returns value from 0.0 (avoiding social) to 2.0 (very eager).
        """
        base_modifier = self.get_behavior_modifier(npc, "social_eagerness")
        
        # Personality also affects this
        personality = npc.get("personality", {})
        extraversion = personality.get("extraversion", 0.5)
        
        # Combine mood modifier with personality
        eagerness = base_modifier * (0.7 + extraversion * 0.6)
        
        return max(0.0, min(2.0, eagerness))
    
    def get_conflict_propensity(self, npc: dict) -> float:
        """
        Get how likely the NPC is to engage in conflict based on mood.
        
        Returns value from 0.0 (peaceful) to 3.0 (very aggressive).
        """
        base_modifier = self.get_behavior_modifier(npc, "conflict_chance")
        
        # Personality also affects this
        personality = npc.get("personality", {})
        agreeableness = personality.get("agreeableness", 0.5)
        neuroticism = personality.get("neuroticism", 0.5)
        
        # Low agreeableness + high neuroticism = more conflict prone
        personality_factor = (1 - agreeableness) * 0.5 + neuroticism * 0.3
        
        propensity = base_modifier * (1.0 + personality_factor)
        
        return max(0.0, min(3.0, propensity))
    
    def get_forgiveness_chance(self, npc: dict) -> float:
        """
        Get the chance the NPC will forgive based on mood.
        
        Returns value from 0.0 (never forgive) to 1.0 (always forgive).
        """
        base_modifier = self.get_behavior_modifier(npc, "forgiveness_chance")
        
        personality = npc.get("personality", {})
        forgiveness_rate = personality.get("forgiveness_rate", 0.5)
        
        chance = base_modifier * forgiveness_rate
        
        return max(0.0, min(1.0, chance))
    
    def process_interaction_outcome(
        self,
        npc: dict,
        other_npc: dict,
        interaction_type: str,
        outcome: str,
    ):
        """
        Process the mood effects of an interaction outcome.
        """
        # Map interaction types to triggers
        trigger_map = {
            ("positive", "success"): "positive_interaction",
            ("positive", "neutral"): "positive_interaction",
            ("negative", "failure"): "negative_interaction",
            ("conflict", "loss"): "conflict",
            ("conflict", "win"): "conflict",
            ("romantic", "success"): "romantic_interaction",
            ("romantic", "rejection"): "rejection",
            ("reconciliation", "success"): "reconciliation",
        }
        
        trigger = trigger_map.get((interaction_type, outcome), "neutral")
        
        if trigger != "neutral":
            # Apply magnitude based on relationship importance
            rel = npc.get("relationships", {}).get(str(other_npc.get("id")), {})
            importance = 0.5 + rel.get("familiarity", 0) * 0.3
            
            self.apply_trigger(npc, trigger, magnitude=importance)
    
    def apply_daily_mood_cycle(self, npc: dict, world_hour: int):
        """
        Apply natural mood shifts based on time of day.
        
        This creates a natural rhythm to NPC moods.
        """
        current = self.get_current_mood(npc)
        current_mood = current.get("current", "neutral")
        intensity = current.get("intensity", 0.5)
        
        # Morning (6-10): Energy boost
        if 6 <= world_hour < 10:
            if current_mood == "neutral" and intensity < 0.6:
                if random.random() < 0.2:
                    self.set_mood(npc, "content", 0.5, cause="morning_energy", duration_ticks=5)
        
        # Midday (11-14): Peak activity
        elif 11 <= world_hour < 14:
            pass  # Mood stays as is
        
        # Afternoon (15-18): Potential boredom
        elif 15 <= world_hour < 18:
            if current_mood == "neutral":
                if random.random() < 0.1:
                    self.set_mood(npc, "bored", 0.3, cause="afternoon_lull", duration_ticks=3)
        
        # Evening (18-22): Relaxation
        elif 18 <= world_hour < 22:
            if current_mood in ("bored", "anxious"):
                if random.random() < 0.3:
                    self.set_mood(npc, "content", 0.4, cause="evening_relax", duration_ticks=5)
        
        # Night (22-6): Rest
        elif world_hour >= 22 or world_hour < 6:
            if current_mood in ("excited", "happy", "angry"):
                # Moods calm down at night
                new_intensity = intensity * 0.8
                if new_intensity < 0.3:
                    self.set_mood(npc, "neutral", 0.5, cause="night_calm", duration_ticks=0)
                else:
                    npc["mood"]["intensity"] = new_intensity
    
    def apply_random_mood_shift(self, npc: dict, chance: float = 0.01):
        """
        Apply a random minor mood shift.
        
        This adds unpredictability to NPC behavior.
        """
        if random.random() > chance:
            return
        
        current = self.get_current_mood(npc)
        current_mood = current.get("current", "neutral")
        intensity = current.get("intensity", 0.5)
        
        # Small shifts
        shifts = {
            "neutral": [("content", 0.1), ("bored", 0.1)],
            "content": [("happy", 0.05), ("neutral", 0.1)],
            "bored": [("neutral", 0.15), ("anxious", 0.05)],
            "happy": [("content", 0.1), ("ecstatic", 0.02)],
            "sad": [("neutral", 0.08), ("heartbroken", 0.02)],
        }
        
        possible_shifts = shifts.get(current_mood, [])
        
        for new_mood, shift_chance in possible_shifts:
            if random.random() < shift_chance:
                new_intensity = intensity + random.uniform(-0.1, 0.1)
                self.set_mood(npc, new_mood, new_intensity, cause="random_shift", duration_ticks=3)
                break
    
    def get_mood_description(self, npc: dict) -> str:
        """Get a human-readable description of NPC's mood."""
        mood = self.get_current_mood(npc)
        current = mood.get("current", "neutral")
        intensity = mood.get("intensity", 0.5)
        cause = mood.get("cause", "unknown")
        
        intensity_desc = "mildly" if intensity < 0.3 else "quite" if intensity < 0.7 else "very"
        
        mood_names = {
            "ecstatic": "thrilled",
            "happy": "happy",
            "content": "content",
            "neutral": "neutral",
            "bored": "bored",
            "sad": "sad",
            "angry": "angry",
            "anxious": "anxious",
            "excited": "excited",
            "romantic": "romantic",
            "heartbroken": "heartbroken",
            "vengeful": "vengeful",
        }
        
        mood_name = mood_names.get(current, current)
        
        return f"Feeling {intensity_desc} {mood_name} (due to {cause})"
    
    def clone_mood_state(self, npc: dict) -> dict:
        """Get a copy of the mood state for serialization."""
        return self.get_current_mood(npc).copy()
