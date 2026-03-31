"""
Relationship Engine - Multi-dimensional relationship management.

Handles trust, respect, attraction, familiarity dimensions and relationship type progression.
"""

import copy
import random
from typing import Dict, List, Optional, Tuple

from .constants import ZODIAC_COMPATIBILITY
from .constants_social import (
    DEFAULT_RELATIONSHIP,
    RELATIONSHIP_DIMENSION_BOUNDS,
    RELATIONSHIP_TYPE_REQUIREMENTS,
    RELATIONSHIP_CHANGE_RATES,
    RELATIONSHIP_NATURAL_DECAY,
    PERSONALITY_RELATIONSHIP_MODIFIERS,
    ROMANTIC_STAGES,
    BREAKUP_TRIGGERS,
)


def clamp(value: float, min_val: float, max_val: float) -> float:
    """Clamp a value to a range."""
    return max(min_val, min(max_val, value))


class RelationshipEngine:
    """Manages multi-dimensional NPC relationships."""
    
    def __init__(self):
        pass

    def get_active_romantic_relationships(
        self,
        npc: dict,
        exclude_other_id: Optional[int] = None,
    ) -> List[Tuple[int, dict]]:
        """Return all active romantic relationships except the optional target."""
        active = []
        for other_id_str, rel in npc.get("relationships", {}).items():
            if not isinstance(rel, dict):
                continue
            try:
                other_id = int(other_id_str)
            except (TypeError, ValueError):
                continue
            if exclude_other_id is not None and other_id == exclude_other_id:
                continue
            if rel.get("type") in ("dating", "partner"):
                active.append((other_id, rel))
        return active

    def _get_romantic_interest_score(self, rel: Optional[dict]) -> float:
        """Estimate how emotionally close a relationship feels for romance gating."""
        if not isinstance(rel, dict):
            return 0.0
        trust = clamp((rel.get("trust", 0.0) + 1.0) / 2.0, 0.0, 1.0)
        attraction = clamp(rel.get("attraction", 0.0), 0.0, 1.0)
        familiarity = clamp(rel.get("familiarity", 0.0), 0.0, 1.0)
        return attraction * 0.45 + trust * 0.35 + familiarity * 0.20

    def _get_romantic_exclusivity(self, npc: dict) -> float:
        """Estimate how strongly an NPC prefers monogamy."""
        personality = npc.get("personality", {})
        loyalty = personality.get("loyalty", 0.5)
        commitment = personality.get("commitment_level", 0.5)
        return clamp(loyalty * 0.7 + commitment * 0.3, 0.0, 1.0)

    def get_new_romance_modifier(
        self,
        npc: dict,
        target_id: int,
        target_rel: Optional[dict] = None,
    ) -> float:
        """
        Return how open this NPC is to a new romance with the target.

        1.0 means no restriction. 0.0 means completely blocked.
        """
        active_romances = self.get_active_romantic_relationships(npc, exclude_other_id=target_id)
        if not active_romances:
            return 1.0

        exclusivity = self._get_romantic_exclusivity(npc)
        if exclusivity >= 0.8:
            return 0.0

        target_interest = self._get_romantic_interest_score(target_rel)
        strongest_existing = 0.0
        for _other_id, rel in active_romances:
            bond_score = self._get_romantic_interest_score(rel)
            if rel.get("type") == "partner":
                bond_score = min(1.0, bond_score + 0.15)
            strongest_existing = max(strongest_existing, bond_score)

        openness = 1.0 - exclusivity
        target_pull = 0.35 + target_interest * 0.65
        commitment_drag = max(0.15, 1.0 - strongest_existing * exclusivity)
        saturation = 0.85 ** max(0, len(active_romances) - 1)
        return clamp(openness * target_pull * commitment_drag * saturation, 0.0, 1.0)

    def get_social_pair_modifier(
        self,
        npc: dict,
        target_id: int,
        target_rel: Optional[dict],
        category: str,
    ) -> float:
        """Reduce casual pairings with low-affinity targets when already committed."""
        if category not in ("socialize", "shop", "eat", "sleep"):
            return 1.0

        active_romances = self.get_active_romantic_relationships(npc, exclude_other_id=target_id)
        if not active_romances:
            return 1.0

        if isinstance(target_rel, dict) and target_rel.get("type") in ("dating", "partner"):
            return 1.0

        exclusivity = self._get_romantic_exclusivity(npc)
        target_interest = self._get_romantic_interest_score(target_rel)

        if category == "sleep":
            return 0.0 if exclusivity >= 0.55 else max(0.05, 1.0 - exclusivity)

        if exclusivity >= 0.8:
            if target_interest < 0.55:
                return 0.0
            return clamp(0.15 + (target_interest - 0.55) * 0.8, 0.15, 0.5)

        modifier = 1.0 - exclusivity * (1.0 - target_interest)
        if category == "socialize":
            modifier *= 0.75 + target_interest * 0.25
        else:
            modifier *= 0.85 + target_interest * 0.15
        return clamp(modifier, 0.05, 1.0)
    
    def get_or_create_relationship(self, npc: dict, other_id: int) -> dict:
        """Get existing relationship or create a new one."""
        relationships = npc.setdefault("relationships", {})
        other_str = str(other_id)
        
        if other_str not in relationships:
            new_rel = copy.deepcopy(DEFAULT_RELATIONSHIP)
            relationships[other_str] = new_rel
            return new_rel
        
        return relationships[other_str]
    
    def get_relationship_value(self, npc: dict, other_id: int, dimension: str) -> float:
        """Get a specific dimension value for a relationship."""
        rel = self.get_or_create_relationship(npc, other_id)
        return rel.get(dimension, DEFAULT_RELATIONSHIP.get(dimension, 0.0))
    
    def get_relationship_type(self, npc: dict, other_id: int) -> str:
        """Get the current relationship type."""
        rel = self.get_or_create_relationship(npc, other_id)
        return rel.get("type", "stranger")
    
    def calculate_relationship_type(self, rel: dict) -> str:
        """Deprecated: Use promotion/demotion logic instead for real-time changes."""
        return rel.get("type", "stranger")

    def update_relationship_type_event_driven(self, rel: dict, change_amount: float) -> Tuple[str, bool]:
        """
        Update relationship type based on a specific change event.
        Promotion: If stats exceed requirements and change is positive.
        Demotion: If stats drop below 0 relative to requirements and change is negative.
        """
        old_type = rel.get("type", "stranger")
        hierarchy = ["stranger", "acquaintance", "friend", "close_friend", "dating", "partner"]
        
        # Special sticky types
        if old_type in ("ex", "enemy", "rival"):
            if rel.get("trust", 0) > 0.2:
                rel["type"] = "acquaintance"
                return "acquaintance", True
            return old_type, False

        try:
            curr_idx = hierarchy.index(old_type)
        except ValueError:
            curr_idx = 0

        # 1. Check for Promotion (to next tier)
        if change_amount > 0 and curr_idx < len(hierarchy) - 1:
            next_type = hierarchy[curr_idx + 1]
            reqs = RELATIONSHIP_TYPE_REQUIREMENTS.get(next_type, {})
            meets_all = True
            for dim, min_v in reqs.items():
                if rel.get(dim, 0.0) < min_v:
                    meets_all = False
                    break
            
            if meets_all:
                rel["type"] = next_type
                return next_type, True

        # 2. Check for Demotion (to previous tier)
        if change_amount < 0 and curr_idx > 0:
            curr_reqs = RELATIONSHIP_TYPE_REQUIREMENTS.get(old_type, {})
            # Demote if they drop significantly below the current tier's gate (e.g. < 0.0 or < threshold * 0.5)
            # Baseline: drop below 0 in any critical dimension mentioned in reqs
            demote = False
            for dim, min_v in curr_reqs.items():
                if rel.get(dim, 0.0) < 0.0: # Dropped below absolute zero/neutral
                    demote = True
                    break
            
            # Special case: dating drop to friend/acquaintance if trust is broken
            if old_type in ("dating", "partner") and rel.get("trust", 0) < 0.0:
                demote = True

            if demote:
                new_type = hierarchy[curr_idx - 1]
                rel["type"] = new_type
                return new_type, True

        return old_type, False

    def update_relationship_type(self, rel: dict) -> Tuple[str, bool]:
        """Backward compatibility: Just returns current type."""
        return rel.get("type", "stranger"), False
    
    def apply_relationship_change(
        self,
        npc: dict,
        other_id: int,
        change_type: str,
        personality: dict,
        magnitude: float = 1.0,
        is_mutual: bool = False,
    ) -> dict:
        """
        Apply a relationship change based on interaction type.
        
        Returns the relationship dict after changes.
        """
        rel = self.get_or_create_relationship(npc, other_id)
        self._apply_change_to_relationship(
            rel,
            change_type,
            personality,
            magnitude=magnitude,
        )
        return rel

    def _apply_change_to_relationship(
        self,
        rel: dict,
        change_type: str,
        personality: dict,
        magnitude: float = 1.0,
    ) -> dict:
        """Apply a relationship change directly to a relationship dict."""
        changes = RELATIONSHIP_CHANGE_RATES.get(change_type, {})
        
        total_net_change = 0.0
        for dim, base_change in changes.items():
            # Get personality modifier
            dim_modifiers = PERSONALITY_RELATIONSHIP_MODIFIERS.get(change_type, {})
            personality_mult = 1.0
            
            if dim in dim_modifiers:
                try:
                    personality_mult = dim_modifiers[dim](personality)
                except (KeyError, TypeError):
                    personality_mult = 1.0
            
            # Calculate final change
            final_change = base_change * personality_mult * magnitude
            total_net_change += final_change
            
            # Apply bounds
            min_val, max_val = RELATIONSHIP_DIMENSION_BOUNDS.get(dim, (-1.0, 1.0))
            current = rel.get(dim, 0.0)
            new_value = clamp(current + final_change, min_val, max_val)
            rel[dim] = new_value
        
        # Update interaction count
        rel["interaction_count"] = rel.get("interaction_count", 0) + 1
        rel["last_interaction_tick"] = rel.get("last_interaction_tick", 0)  # Will be set by caller
        
        if change_type in ("positive_interaction", "deep_conversation", "romantic_interaction", "reconciliation"):
            rel["positive_interactions"] = rel.get("positive_interactions", 0) + 1
        elif change_type in ("negative_interaction", "conflict", "betrayal"):
            rel["negative_interactions"] = rel.get("negative_interactions", 0) + 1
        
        # Update type using event-driven logic
        self.update_relationship_type_event_driven(rel, total_net_change)
        
        return rel

    def preview_relationship_change(
        self,
        rel: dict,
        change_type: str,
        personality: dict,
        magnitude: float = 1.0,
    ) -> dict:
        """Preview the post-interaction relationship without mutating the original."""
        rel_copy = copy.deepcopy(rel)
        before_type = rel.get("type", "stranger")
        self._apply_change_to_relationship(
            rel_copy,
            change_type,
            personality,
            magnitude=magnitude,
        )
        return {
            "before_type": before_type,
            "after_type": rel_copy.get("type", "stranger"),
            "relationship": rel_copy,
        }
    
    def apply_natural_decay(self, rel: dict, world_hours_delta: float):
        """Apply natural relationship decay over time."""
        for dim, decay_rate in RELATIONSHIP_NATURAL_DECAY.items():
            current = rel.get(dim, 0.0)
            # Only decay positive values toward zero, negative values toward zero
            if current > 0:
                new_value = max(0.0, current - decay_rate * world_hours_delta)
            else:
                new_value = min(0.0, current + decay_rate * world_hours_delta)
            
            min_val, max_val = RELATIONSHIP_DIMENSION_BOUNDS.get(dim, (-1.0, 1.0))
            rel[dim] = clamp(new_value, min_val, max_val)
    
    def check_breakup(
        self,
        npc_a: dict,
        npc_b: dict,
        rel_a: dict,
        rel_b: dict,
        tick_count: int,
        world_hours_delta: float = 1.0,
    ) -> Optional[dict]:
        """
        Check if a romantic relationship should end.
        
        Returns breakup info if breakup occurs, None otherwise.
        """
        rel_type = rel_a.get("type", "stranger")
        
        if rel_type not in ("dating", "partner"):
            return None
        
        personality_a = npc_a.get("personality", {})
        personality_b = npc_b.get("personality", {})
        
        # Check each breakup trigger
        for trigger_name, trigger_config in BREAKUP_TRIGGERS.items():
            base_chance = trigger_config.get("chance", 0.0)
            # Scale chance by time
            chance = base_chance * world_hours_delta
            
            if trigger_name == "trust_betrayal":
                if rel_a.get("trust", 0) < trigger_config.get("trust_threshold", -0.2):
                    if random.random() < chance:
                        return {"trigger": "trust_betrayal", "initiator": npc_a["id"]}
                if rel_b.get("trust", 0) < trigger_config.get("trust_threshold", -0.2):
                    if random.random() < chance:
                        return {"trigger": "trust_betrayal", "initiator": npc_b["id"]}
            
            elif trigger_name == "attraction_fade":
                min_attraction = trigger_config.get("attraction_threshold", 0.2)
                if (rel_a.get("attraction", 0) < min_attraction and 
                    rel_b.get("attraction", 0) < min_attraction):
                    if random.random() < chance:
                        return {"trigger": "attraction_fade", "initiator": npc_a["id"]}
            
            elif trigger_name == "incompatibility":
                conflict_count = rel_a.get("negative_interactions", 0)
                if conflict_count >= trigger_config.get("conflict_count_threshold", 5):
                    if random.random() < chance:
                        return {"trigger": "incompatibility", "initiator": npc_a["id"]}
            
            elif trigger_name == "external_pressure":
                if random.random() < chance:
                    return {"trigger": "external_pressure", "initiator": npc_a["id"]}
            
            elif trigger_name == "random":
                # Commitment protects against random breakups
                commitment_a = personality_a.get("commitment_level", 0.5)
                commitment_b = personality_b.get("commitment_level", 0.5)
                avg_commitment = (commitment_a + commitment_b) / 2
                
                protection = trigger_config.get("commitment_protection", 0.8)
                adjusted_chance = chance * (1 - avg_commitment * protection)
                
                if random.random() < adjusted_chance:
                    return {"trigger": "random", "initiator": npc_a["id"]}
        
        return None
    
    def execute_breakup(
        self,
        npc_a: dict,
        npc_b: dict,
        rel_a: dict,
        rel_b: dict,
        breakup_info: dict,
    ):
        """Execute a breakup between two NPCs."""
        # Apply breakup relationship changes
        breakup_changes = RELATIONSHIP_CHANGE_RATES.get("breakup", {})
        
        for dim, change in breakup_changes.items():
            min_val, max_val = RELATIONSHIP_DIMENSION_BOUNDS.get(dim, (-1.0, 1.0))
            
            rel_a[dim] = clamp(rel_a.get(dim, 0.0) + change, min_val, max_val)
            rel_b[dim] = clamp(rel_b.get(dim, 0.0) + change, min_val, max_val)
        
        # Set type to ex
        rel_a["type"] = "ex"
        rel_b["type"] = "ex"
        
        # Add to history
        rel_a.setdefault("history", []).append({
            "event": "breakup",
            "partner_id": npc_b["id"],
            "trigger": breakup_info.get("trigger", "unknown"),
            "initiator": breakup_info.get("initiator") == npc_a["id"],
        })
        rel_b.setdefault("history", []).append({
            "event": "breakup",
            "partner_id": npc_a["id"],
            "trigger": breakup_info.get("trigger", "unknown"),
            "initiator": breakup_info.get("initiator") == npc_b["id"],
        })
    
    def check_crush_formation(
        self,
        npc_a: dict,
        npc_b: dict,
        rel_a: dict,
        rel_b: dict,
        zodiac_compat: float,
        world_hours_delta: float = 1.0,
    ) -> bool:
        """
        Check if NPC A develops a crush on NPC B.
        
        Returns True if crush forms.
        """
        # Already in romantic relationship
        if rel_a.get("type") in ("crush", "dating", "partner", "ex"):
            return False
        
        personality_a = npc_a.get("personality", {})
        
        # Calculate crush chance. Base: 2% per world-hour
        base_chance = 0.02 * world_hours_delta
        
        # Attraction increases chance (scales from x0.5 to x4.0)
        attraction = rel_a.get("attraction", 0)
        attraction_mult = 0.5 + attraction * 3.5
        
        # Familiarity helps (scales from x0.5 to x2.0)
        familiarity = rel_a.get("familiarity", 0)
        familiarity_mult = 0.5 + familiarity * 1.5
        
        # Zodiac compatibility
        zodiac_mult = 1.0 + (zodiac_compat - 0.5) * 0.5
        
        # Personality effects
        romantic_eagerness = personality_a.get("romantic_eagerness", 0.5)
        personality_mult = 1.0 + romantic_eagerness * 0.5
        openness_mult = self.get_new_romance_modifier(npc_a, npc_b["id"], rel_a)
        if openness_mult <= 0.0:
            return False

        final_chance = (
            base_chance
            * attraction_mult
            * familiarity_mult
            * zodiac_mult
            * personality_mult
            * openness_mult
        )
        
        if random.random() < final_chance:
            rel_a["type"] = "crush"
            rel_a.setdefault("history", []).append({
                "event": "crush_formed",
                "target_id": npc_b["id"],
            })
            return True
        
        return False
    
    def can_confess(
        self,
        npc_a: dict,
        npc_b: dict,
        rel_a: dict,
        rel_b: dict,
    ) -> Tuple[bool, float]:
        """
        Check if NPC A can confess feelings to NPC B.
        
        Returns (can_confess, success_chance).
        """
        # Must have a crush
        if rel_a.get("type") != "crush":
            return False, 0.0

        confessor_openness = self.get_new_romance_modifier(npc_a, npc_b["id"], rel_a)
        receiver_openness = self.get_new_romance_modifier(npc_b, npc_a["id"], rel_b)
        if confessor_openness <= 0.0 or receiver_openness <= 0.0:
            return False, 0.0
        
        personality_a = npc_a.get("personality", {})
        personality_b = npc_b.get("personality", {})
        
        # Courage based on extraversion
        extraversion = personality_a.get("extraversion", 0.5)
        courage = (0.3 + extraversion * 0.5) * (0.35 + confessor_openness * 0.65)
        
        # Success chance calculation (VERY dependent on trust and familiarity)
        attraction_b = rel_b.get("attraction", 0.0)
        trust_b = rel_b.get("trust", 0.0)
        familiarity_b = rel_b.get("familiarity", 0.0)
        
        # B's romantic eagerness affects receptiveness
        romantic_eagerness_b = personality_b.get("romantic_eagerness", 0.5)
        
        # Success factors
        success_chance = -0.2  # Penalty for strangers!
        success_chance += attraction_b * 0.5  # B's attraction to A
        success_chance += trust_b * 0.6  # B's trust in A (critical)
        success_chance += familiarity_b * 0.3  # How well they know each other
        success_chance += romantic_eagerness_b * 0.2
        
        # Mutual crush = high bonus
        if rel_b.get("type") == "crush":
            success_chance += 0.5

        success_chance *= receiver_openness
        return random.random() < courage, clamp(success_chance, 0.01, 1.0)
    
    def attempt_confession(
        self,
        npc_a: dict,
        npc_b: dict,
        rel_a: dict,
        rel_b: dict,
        success_chance: float,
    ) -> bool:
        """
        Attempt a confession from A to B.
        
        Returns True if successful (both become dating).
        """
        if random.random() < success_chance:
            # Success - start dating
            rel_a["type"] = "dating"
            rel_b["type"] = "dating"
            
            # Boost attraction and trust
            rel_a["attraction"] = clamp(rel_a.get("attraction", 0) + 0.1, 0, 1)
            rel_b["attraction"] = clamp(rel_b.get("attraction", 0) + 0.1, 0, 1)
            rel_a["trust"] = clamp(rel_a.get("trust", 0) + 0.05, -1, 1)
            rel_b["trust"] = clamp(rel_b.get("trust", 0) + 0.05, -1, 1)
            
            rel_a.setdefault("history", []).append({
                "event": "confession_accepted",
                "partner_id": npc_b["id"],
            })
            rel_b.setdefault("history", []).append({
                "event": "confession_received",
                "partner_id": npc_a["id"],
            })
            
            return True
        else:
            # Rejection
            rel_a["type"] = "friend"  # Revert to friend
            rel_a["attraction"] = clamp(rel_a.get("attraction", 0) - 0.1, 0, 1)  # Hurt feelings
            rel_a.setdefault("history", []).append({
                "event": "confession_rejected",
                "target_id": npc_b["id"],
            })
            
            return False
    
    def check_dating_to_partner(
        self,
        npc_a: dict,
        npc_b: dict,
        rel_a: dict,
        rel_b: dict,
        world_hours_together: float,
        world_hours_delta: float = 1.0,
    ) -> bool:
        """
        Check if dating NPCs should become partners.
        """
        if rel_a.get("type") != "dating":
            return False
        
        requirements = {
            "min_duration_world_hours": 72,  # 3 days
            "min_trust": 0.75,
            "min_attraction": 0.6,
            "min_familiarity": 0.8,
        }
        
        # Check duration
        if world_hours_together < requirements["min_duration_world_hours"]:
            return False
        
        # Check trust and dimensions
        if rel_a.get("trust", 0) < requirements["min_trust"] or rel_b.get("trust", 0) < requirements["min_trust"]:
            return False
        if rel_a.get("attraction", 0) < requirements["min_attraction"]:
            return False
        
        # Base: 5% chance per world-hour
        base_chance = 0.05 * world_hours_delta
        
        # Commitment affects chance
        commitment_a = npc_a.get("personality", {}).get("commitment_level", 0.5)
        commitment_b = npc_b.get("personality", {}).get("commitment_level", 0.5)
        avg_commitment = (commitment_a + commitment_b) / 2
        
        final_chance = base_chance * (0.5 + avg_commitment * 1.5)
        
        if random.random() < final_chance:
            rel_a["type"] = "partner"
            rel_b["type"] = "partner"
            
            rel_a.setdefault("history", []).append({
                "event": "became_partner",
                "partner_id": npc_b["id"],
            })
            rel_b.setdefault("history", []).append({
                "event": "became_partner",
                "partner_id": npc_a["id"],
            })
            
            return True
        
        return False
    
    def get_compatibility_score(
        self,
        npc_a: dict,
        npc_b: dict,
    ) -> float:
        """
        Calculate overall compatibility between two NPCs.
        
        Returns score from 0.0 to 1.0.
        """
        # Zodiac compatibility
        zodiac_a = npc_a.get("zodiac_index", 0)
        zodiac_b = npc_b.get("zodiac_index", 0)
        zodiac_compat = ZODIAC_COMPATIBILITY[zodiac_a][zodiac_b]
        
        # Personality compatibility
        personality_a = npc_a.get("personality", {})
        personality_b = npc_b.get("personality", {})
        
        # Similar vs complementary traits
        # High agreeableness pairs well
        agree_a = personality_a.get("agreeableness", 0.5)
        agree_b = personality_b.get("agreeableness", 0.5)
        
        # Extraversion matching (similar is better)
        extra_a = personality_a.get("extraversion", 0.5)
        extra_b = personality_b.get("extraversion", 0.5)
        extra_compat = 1.0 - abs(extra_a - extra_b) * 0.3
        
        # Openness matching
        open_a = personality_a.get("openness", 0.5)
        open_b = personality_b.get("openness", 0.5)
        open_compat = 1.0 - abs(open_a - open_b) * 0.2
        
        # Neuroticism (both high = volatile, both low = stable)
        neuro_a = personality_a.get("neuroticism", 0.5)
        neuro_b = personality_b.get("neuroticism", 0.5)
        if neuro_a > 0.7 and neuro_b > 0.7:
            neuro_compat = 0.6  # Volatile
        elif neuro_a < 0.3 and neuro_b < 0.3:
            neuro_compat = 0.9  # Stable
        else:
            neuro_compat = 0.75  # Mixed is okay
        
        # Weighted average
        compatibility = (
            zodiac_compat * 0.2 +
            extra_compat * 0.2 +
            open_compat * 0.15 +
            neuro_compat * 0.15 +
            (agree_a + agree_b) / 2 * 0.3
        )
        
        return clamp(compatibility, 0.0, 1.0)
    
    def get_relationship_summary(self, rel: dict) -> dict:
        """Get a summary of a relationship for display."""
        return {
            "type": rel.get("type", "stranger"),
            "trust": rel.get("trust", 0.0),
            "respect": rel.get("respect", 0.0),
            "attraction": rel.get("attraction", 0.0),
            "familiarity": rel.get("familiarity", 0.0),
            "interaction_count": rel.get("interaction_count", 0),
            "positive_interactions": rel.get("positive_interactions", 0),
            "negative_interactions": rel.get("negative_interactions", 0),
            "history_count": len(rel.get("history", [])),
        }
