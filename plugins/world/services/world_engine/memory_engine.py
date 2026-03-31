"""
Memory Engine - NPC memory formation, decay, and retrieval.

Handles memory creation, importance calculation, decay over time, and retrieval for decision-making.
"""

import copy
import random
import hashlib
from typing import Dict, List, Optional, Any

from .constants_social import (
    MEMORY_TYPES,
    MEMORY_IMPORTANCE_BASE,
    MEMORY_DECAY_RATE,
    MEMORY_FORGET_THRESHOLD,
    MAX_MEMORIES_PER_NPC,
    MEMORY_EMOTIONAL_IMPACT,
)


def generate_memory_id() -> str:
    """Generate a unique memory ID."""
    return f"mem_{hashlib.md5(str(random.random()).encode()).hexdigest()[:12]}"


class MemoryEngine:
    """Manages NPC memories."""
    
    def __init__(self):
        pass
    
    def create_memory(
        self,
        memory_type: str,
        participants: List[int],
        location_id: Optional[int],
        tick: int,
        summary: str,
        emotional_impact: Optional[Dict[str, float]] = None,
        importance_override: Optional[float] = None,
        extra_data: Optional[Dict[str, Any]] = None,
    ) -> dict:
        """
        Create a new memory.
        
        Args:
            memory_type: Type of memory (interaction, conflict, romantic, etc.)
            participants: List of NPC IDs involved
            location_id: Where the memory occurred
            tick: World tick when memory occurred
            summary: Human-readable summary
            emotional_impact: Dict of dimension -> impact value
            importance_override: Override base importance
            extra_data: Additional data to store
        
        Returns:
            Memory dict
        """
        base_importance = MEMORY_IMPORTANCE_BASE.get(memory_type, 0.3)
        importance = importance_override if importance_override is not None else base_importance
        
        # Calculate emotional impact
        if emotional_impact is None:
            emotional_impact = MEMORY_EMOTIONAL_IMPACT.get(memory_type, {}).copy()
        
        memory = {
            "id": generate_memory_id(),
            "type": memory_type,
            "participants": list(participants),
            "location": location_id,
            "tick": tick,
            "summary": summary,
            "emotional_impact": emotional_impact,
            "importance": importance,
            "decayed_importance": importance,
            "extra_data": extra_data or {},
        }
        
        return memory
    
    def add_memory_to_npc(self, npc: dict, memory: dict):
        """Add a memory to an NPC's memory list."""
        memories = npc.setdefault("memories", [])
        memories.append(memory)
        
        # Enforce memory limit
        if len(memories) > MAX_MEMORIES_PER_NPC:
            self._prune_memories(memories)
    
    def _prune_memories(self, memories: List[dict]):
        """Remove least important memories when over limit."""
        # Sort by decayed importance (lowest first)
        memories.sort(key=lambda m: m.get("decayed_importance", 0))
        
        # Remove memories below threshold or excess
        while len(memories) > MAX_MEMORIES_PER_NPC:
            memories.pop(0)
    
    def decay_memories(self, npc: dict, world_hours_delta: float):
        """
        Decay all memories for an NPC over time.
        
        Removes memories that fall below forget threshold.
        """
        memories = npc.get("memories", [])
        if not memories:
            return
        
        for memory in memories:
            memory_type = memory.get("type", "interaction")
            decay_rate = MEMORY_DECAY_RATE.get(memory_type, 0.02)
            
            current = memory.get("decayed_importance", memory.get("importance", 0.3))
            new_importance = current - decay_rate * world_hours_delta
            memory["decayed_importance"] = max(0.0, new_importance)
        
        # Remove forgotten memories
        npc["memories"] = [
            m for m in memories
            if m.get("decayed_importance", 0) >= MEMORY_FORGET_THRESHOLD
        ]
    
    def get_memories_about(self, npc: dict, other_id: int) -> List[dict]:
        """Get all memories involving a specific other NPC."""
        memories = npc.get("memories", [])
        return [
            m for m in memories
            if other_id in m.get("participants", [])
        ]
    
    def get_memories_at_location(self, npc: dict, location_id: int) -> List[dict]:
        """Get all memories at a specific location."""
        memories = npc.get("memories", [])
        return [
            m for m in memories
            if m.get("location") == location_id
        ]
    
    def get_memories_of_type(self, npc: dict, memory_type: str) -> List[dict]:
        """Get all memories of a specific type."""
        memories = npc.get("memories", [])
        return [m for m in memories if m.get("type") == memory_type]
    
    def get_most_important_memories(self, npc: dict, count: int = 5) -> List[dict]:
        """Get the most important memories for an NPC."""
        memories = npc.get("memories", [])
        sorted_memories = sorted(
            memories,
            key=lambda m: m.get("decayed_importance", 0),
            reverse=True
        )
        return sorted_memories[:count]
    
    def get_recent_memories(self, npc: dict, tick: int, count: int = 5) -> List[dict]:
        """Get the most recent memories."""
        memories = npc.get("memories", [])
        sorted_memories = sorted(
            memories,
            key=lambda m: m.get("tick", 0),
            reverse=True
        )
        return sorted_memories[:count]
    
    def get_memory_sentiment_toward(self, npc: dict, other_id: int) -> float:
        """
        Calculate overall sentiment toward another NPC based on memories.
        
        Returns value from -1.0 (very negative) to 1.0 (very positive).
        """
        memories = self.get_memories_about(npc, other_id)
        if not memories:
            return 0.0
        
        total_weight = 0.0
        total_sentiment = 0.0
        
        for memory in memories:
            importance = memory.get("decayed_importance", 0.1)
            impact = memory.get("emotional_impact", {})
            
            # Calculate sentiment from emotional impact
            sentiment = 0.0
            for dim, value in impact.items():
                if dim in ("trust", "respect", "attraction", "familiarity"):
                    sentiment += value
            
            total_weight += importance
            total_sentiment += sentiment * importance
        
        if total_weight == 0:
            return 0.0
        
        return total_sentiment / total_weight
    
    def has_traumatic_memory_with(self, npc: dict, other_id: int) -> bool:
        """Check if NPC has traumatic memories involving another NPC."""
        memories = self.get_memories_about(npc, other_id)
        for memory in memories:
            if memory.get("type") in ("trauma", "betrayal"):
                if memory.get("decayed_importance", 0) > 0.3:
                    return True
        return False
    
    def has_positive_memory_with(self, npc: dict, other_id: int) -> bool:
        """Check if NPC has significant positive memories with another NPC."""
        memories = self.get_memories_about(npc, other_id)
        for memory in memories:
            if memory.get("type") in ("romantic", "deep_conversation", "shared_experience"):
                if memory.get("decayed_importance", 0) > 0.4:
                    return True
        return False
    
    def get_conflict_memory_count(self, npc: dict, other_id: int) -> int:
        """Count conflict memories with another NPC."""
        memories = self.get_memories_about(npc, other_id)
        return sum(
            1 for m in memories
            if m.get("type") in ("conflict", "betrayal") and m.get("decayed_importance", 0) > 0.1
        )
    
    def create_interaction_memory(
        self,
        npc_a: dict,
        npc_b: dict,
        interaction_type: str,
        location_id: int,
        tick: int,
        outcome: str = "neutral",
        details: Optional[str] = None,
    ) -> tuple:
        """
        Create memories for both NPCs after an interaction.
        
        Returns (memory_a, memory_b).
        """
        # Determine memory type based on interaction
        memory_type_map = {
            "positive": "interaction",
            "negative": "interaction",
            "deep_conversation": "deep_conversation",
            "conflict": "conflict",
            "romantic": "romantic",
            "reconciliation": "reconciliation",
            "betrayal": "betrayal",
        }
        memory_type = memory_type_map.get(interaction_type, "interaction")
        
        # Generate summary
        summary_template = {
            "positive": f"Had a pleasant interaction with {npc_b['name']}",
            "negative": f"Had an unpleasant interaction with {npc_b['name']}",
            "deep_conversation": f"Had a meaningful conversation with {npc_b['name']}",
            "conflict": f"Had a conflict with {npc_b['name']}",
            "romantic": f"Had a romantic moment with {npc_b['name']}",
            "reconciliation": f"Made up with {npc_b['name']}",
            "betrayal": f"Was betrayed by {npc_b['name']}",
        }
        summary_a = summary_template.get(interaction_type, f"Interacted with {npc_b['name']}")
        summary_b = summary_template.get(interaction_type, f"Interacted with {npc_a['name']}")
        summary_b = summary_b.replace(npc_b['name'], npc_a['name'])
        
        if details:
            summary_a += f" - {details}"
            summary_b += f" - {details}"
        
        # Create memories
        memory_a = self.create_memory(
            memory_type=memory_type,
            participants=[npc_a["id"], npc_b["id"]],
            location_id=location_id,
            tick=tick,
            summary=summary_a,
        )
        
        memory_b = self.create_memory(
            memory_type=memory_type,
            participants=[npc_a["id"], npc_b["id"]],
            location_id=location_id,
            tick=tick,
            summary=summary_b,
        )
        
        # Add to NPCs
        self.add_memory_to_npc(npc_a, memory_a)
        self.add_memory_to_npc(npc_b, memory_b)
        
        return memory_a, memory_b
    
    def create_event_memory(
        self,
        npc: dict,
        event_type: str,
        tick: int,
        summary: str,
        location_id: Optional[int] = None,
        participants: Optional[List[int]] = None,
        importance: Optional[float] = None,
    ) -> dict:
        """
        Create a memory for a significant event.
        """
        memory = self.create_memory(
            memory_type=event_type,
            participants=participants or [],
            location_id=location_id,
            tick=tick,
            summary=summary,
            importance_override=importance,
        )
        
        self.add_memory_to_npc(npc, memory)
        return memory
    
    def recall_for_decision(
        self,
        npc: dict,
        context: dict,
    ) -> List[dict]:
        """
        Retrieve relevant memories for a decision.
        
        Args:
            npc: The NPC making a decision
            context: Context dict with keys like:
                - target_id: NPC being considered
                - location_id: Location being considered
                - activity: Activity being considered
        
        Returns:
            List of relevant memories sorted by relevance
        """
        memories = npc.get("memories", [])
        scored_memories = []
        
        target_id = context.get("target_id")
        location_id = context.get("location_id")
        
        for memory in memories:
            score = memory.get("decayed_importance", 0)
            
            # Boost if involves target
            if target_id and target_id in memory.get("participants", []):
                score *= 2.0
            
            # Boost if at location
            if location_id and memory.get("location") == location_id:
                score *= 1.5
            
            # Boost if recent
            tick = memory.get("tick", 0)
            current_tick = context.get("current_tick", tick)
            recency = max(0, 1.0 - (current_tick - tick) / 1000)
            score *= (1.0 + recency)
            
            if score > 0.05:  # Only include somewhat relevant memories
                scored_memories.append((score, memory))
        
        # Sort by score descending
        scored_memories.sort(key=lambda x: x[0], reverse=True)
        
        return [m for _, m in scored_memories[:10]]
    
    def get_memory_influence_on_relationship(
        self,
        npc: dict,
        other_id: int,
    ) -> Dict[str, float]:
        """
        Calculate how memories influence current relationship dimensions.
        
        Returns dict of dimension -> influence value.
        """
        memories = self.get_memories_about(npc, other_id)
        influences = {
            "trust": 0.0,
            "respect": 0.0,
            "attraction": 0.0,
            "familiarity": 0.0,
        }
        
        for memory in memories:
            importance = memory.get("decayed_importance", 0.1)
            impact = memory.get("emotional_impact", {})
            
            for dim in influences:
                if dim in impact:
                    influences[dim] += impact[dim] * importance
        
        return influences
    
    def summarize_relationship_history(
        self,
        npc: dict,
        other_id: int,
    ) -> dict:
        """
        Create a summary of relationship history with another NPC.
        """
        memories = self.get_memories_about(npc, other_id)
        
        if not memories:
            return {
                "total_memories": 0,
                "positive_count": 0,
                "negative_count": 0,
                "neutral_count": 0,
                "first_interaction_tick": None,
                "last_interaction_tick": None,
                "most_significant_event": None,
            }
        
        positive_types = {"interaction", "deep_conversation", "romantic", "shared_experience", "reconciliation"}
        negative_types = {"conflict", "betrayal", "trauma", "breakup"}
        
        positive_count = sum(1 for m in memories if m.get("type") in positive_types)
        negative_count = sum(1 for m in memories if m.get("type") in negative_types)
        neutral_count = len(memories) - positive_count - negative_count
        
        ticks = [m.get("tick", 0) for m in memories]
        
        # Find most significant memory
        most_significant = max(memories, key=lambda m: m.get("importance", 0))
        
        return {
            "total_memories": len(memories),
            "positive_count": positive_count,
            "negative_count": negative_count,
            "neutral_count": neutral_count,
            "first_interaction_tick": min(ticks) if ticks else None,
            "last_interaction_tick": max(ticks) if ticks else None,
            "most_significant_event": {
                "type": most_significant.get("type"),
                "summary": most_significant.get("summary"),
                "tick": most_significant.get("tick"),
            } if most_significant else None,
        }
