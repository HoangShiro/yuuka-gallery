"""
Social Dynamics Engine - Groups, rumors, conflicts, and romantic progression.

Manages complex social interactions between NPCs including group formation,
gossip spreading, conflict escalation, and romantic relationship progression.
"""

import copy
import random
import hashlib
from typing import Dict, List, Optional, Tuple, Any

from .constants import ZODIAC_COMPATIBILITY
from .constants_social import (
    GROUP_TYPES,
    GROUP_FORMATION_THRESHOLDS,
    GROUP_COHESION_CHANGE,
    RUMOR_TYPES,
    RUMOR_SPREAD_MODIFIERS,
    RUMOR_REPUTATION_IMPACT,
    CONFLICT_TYPES,
    CONFLICT_ESCALATION_THRESHOLDS,
    CONFLICT_RESOLUTION_BASE_CHANCE,
    CHAOS_FACTOR_CONFIG,
    HOME_LEAVING_TRIGGERS,
    RANDOM_SHOCK_EVENTS,
)


def generate_group_id() -> str:
    """Generate a unique group ID."""
    return f"group_{hashlib.md5(str(random.random()).encode()).hexdigest()[:8]}"


def generate_rumor_id() -> str:
    """Generate a unique rumor ID."""
    return f"rumor_{hashlib.md5(str(random.random()).encode()).hexdigest()[:8]}"


def generate_conflict_id() -> str:
    """Generate a unique conflict ID."""
    return f"conflict_{hashlib.md5(str(random.random()).encode()).hexdigest()[:8]}"


class SocialDynamicsEngine:
    """Manages social groups, rumors, conflicts, and romantic progression."""
    
    def __init__(self):
        self._groups: Dict[str, dict] = {}
        self._rumors: Dict[str, dict] = {}
        self._conflicts: Dict[str, dict] = {}
        self._chaos_factor: float = CHAOS_FACTOR_CONFIG["initial_chaos"]
        self._tick_count: int = 0
    
    # ─── Chaos Factor Management ─────────────────────────────────────────────
    
    def get_chaos_factor(self) -> float:
        """Get current chaos factor."""
        return self._chaos_factor
    
    def update_chaos_factor(self, tick_count: int):
        """
        Update chaos factor based on time.
        
        Chaos decreases over time but never goes below minimum.
        """
        self._tick_count = tick_count
        
        config = CHAOS_FACTOR_CONFIG
        decay_rate = config["decay_rate"]
        min_chaos = config["min_chaos"]
        
        # Decay chaos
        self._chaos_factor = max(min_chaos, self._chaos_factor - decay_rate)
    
    def inject_chaos(self, amount: float):
        """Inject chaos into the system (from random events)."""
        max_chaos = CHAOS_FACTOR_CONFIG["initial_chaos"]
        self._chaos_factor = min(max_chaos, self._chaos_factor + amount)
    
    def get_chaos_modified_chance(self, base_chance: float) -> float:
        """
        Modify a chance based on current chaos factor.
        
        Higher chaos = higher chance for dynamic events.
        """
        return base_chance * self._chaos_factor
    
    # ─── Social Groups ────────────────────────────────────────────────────────
    
    def get_groups(self) -> Dict[str, dict]:
        """Get all social groups."""
        return self._groups
    
    def get_groups_for_npc(self, npc_id: int) -> List[dict]:
        """Get all groups an NPC belongs to."""
        return [
            g for g in self._groups.values()
            if npc_id in g.get("members", [])
        ]
    
    def create_group(
        self,
        group_type: str,
        members: List[int],
        leader_id: Optional[int] = None,
        name: Optional[str] = None,
        location_id: Optional[int] = None,
    ) -> dict:
        """
        Create a new social group.
        
        Args:
            group_type: Type of group (clique, work_group, family, romantic)
            members: List of NPC IDs in the group
            leader_id: Optional leader NPC ID
            name: Optional group name
            location_id: Optional associated location
        
        Returns:
            The created group dict
        """
        group = {
            "id": generate_group_id(),
            "name": name or f"{group_type.capitalize()} Group",
            "type": group_type,
            "members": list(members),
            "leader": leader_id or (members[0] if members else None),
            "cohesion": 0.5,
            "formed_tick": self._tick_count,
            "location": location_id,
            "shared_memories": [],
            "status": "active",
        }
        
        self._groups[group["id"]] = group
        return group
    
    def check_group_formation(
        self,
        npcs: Dict[int, dict],
        locations: Dict[int, dict],
    ) -> List[dict]:
        """
        Check for potential group formations.
        
        Returns list of newly formed groups.
        """
        new_groups = []
        
        # Check for clique formation (friends who interact frequently)
        for npc_id, npc in npcs.items():
            potential_members = self._find_potential_clique_members(npc, npcs)
            
            if len(potential_members) >= 3:
                # Check if already in a clique together
                existing = self._find_shared_group(npc_id, potential_members, "clique")
                if existing:
                    continue
                
                # Calculate average cohesion
                cohesion = self._calculate_group_cohesion(potential_members, npcs)
                
                if cohesion >= GROUP_FORMATION_THRESHOLDS["clique"]["min_cohesion"]:
                    group = self.create_group(
                        group_type="clique",
                        members=potential_members,
                        leader_id=npc_id,
                    )
                    group["cohesion"] = cohesion
                    new_groups.append(group)
        
        # Check for work group formation
        for loc_id, loc in locations.items():
            if loc.get("type") not in GROUP_FORMATION_THRESHOLDS["work_group"]["location_type"]:
                continue
            
            workers = [
                npc_id for npc_id in loc.get("occupant_ids", [])
                if npcs.get(npc_id, {}).get("activity") == "work"
            ]
            
            if len(workers) >= 2:
                existing = self._find_shared_group(workers[0], workers, "work_group")
                if not existing:
                    group = self.create_group(
                        group_type="work_group",
                        members=workers,
                        location_id=loc_id,
                        name=f"{loc.get('name', 'Workplace')} Team",
                    )
                    new_groups.append(group)
        
        return new_groups
    
    def _find_potential_clique_members(self, npc: dict, npcs: Dict[int, dict]) -> List[int]:
        """Find NPCs who could form a clique with the given NPC."""
        potential = [npc["id"]]
        
        relationships = npc.get("relationships", {})
        
        for other_id_str, rel in relationships.items():
            other_id = int(other_id_str)
            other = npcs.get(other_id)
            
            if not other:
                continue
            
            # Must be friends or closer
            rel_type = rel.get("type", "stranger")
            if rel_type not in ("friend", "close_friend", "crush", "dating", "partner"):
                continue
            
            # Check mutual relationships
            other_rel = other.get("relationships", {}).get(str(npc["id"]), {})
            if other_rel.get("type") in ("friend", "close_friend", "crush", "dating", "partner"):
                potential.append(other_id)
        
        return potential
    
    def _find_shared_group(self, npc_id: int, other_ids: List[int], group_type: str) -> Optional[dict]:
        """Find if NPCs already share a group of given type."""
        for group in self._groups.values():
            if group.get("type") != group_type:
                continue
            if npc_id in group.get("members", []):
                if all(oid in group.get("members", []) for oid in other_ids):
                    return group
        return None
    
    def _calculate_group_cohesion(self, member_ids: List[int], npcs: Dict[int, dict]) -> float:
        """Calculate average cohesion between group members."""
        if len(member_ids) < 2:
            return 0.0
        
        total = 0.0
        count = 0
        
        for i, id_a in enumerate(member_ids):
            for id_b in member_ids[i+1:]:
                npc_a = npcs.get(id_a, {})
                npc_b = npcs.get(id_b, {})
                
                rel_a = npc_a.get("relationships", {}).get(str(id_b), {})
                rel_b = npc_b.get("relationships", {}).get(str(id_a), {})
                
                # Average of trust and familiarity
                trust = (rel_a.get("trust", 0.3) + rel_b.get("trust", 0.3)) / 2
                familiarity = (rel_a.get("familiarity", 0.2) + rel_b.get("familiarity", 0.2)) / 2
                
                total += (trust + familiarity) / 2
                count += 1
        
        return total / count if count > 0 else 0.0
    
    def update_group_cohesion(self, group: dict, event: str, magnitude: float = 1.0):
        """Update group cohesion based on an event."""
        change = GROUP_COHESION_CHANGE.get(event, 0)
        group["cohesion"] = max(0.0, min(1.0, group["cohesion"] + change * magnitude))
        
        # Low cohesion groups dissolve
        if group["cohesion"] < 0.2 and group.get("type") != "family":
            group["status"] = "dissolved"
    
    def add_member_to_group(self, group: dict, npc_id: int):
        """Add a member to a group."""
        if npc_id not in group.get("members", []):
            group["members"].append(npc_id)
            self.update_group_cohesion(group, "new_member_joins")
    
    def remove_member_from_group(self, group: dict, npc_id: int):
        """Remove a member from a group."""
        if npc_id in group.get("members", []):
            group["members"].remove(npc_id)
            self.update_group_cohesion(group, "member_leaves")
            
            # Update leader if needed
            if group.get("leader") == npc_id:
                if group.get("members"):
                    group["leader"] = group["members"][0]
                else:
                    group["status"] = "dissolved"
    
    # ─── Rumors & Gossip ──────────────────────────────────────────────────────
    
    def get_rumors(self) -> Dict[str, dict]:
        """Get all rumors."""
        return self._rumors
    
    def get_rumors_about(self, npc_id: int) -> List[dict]:
        """Get all rumors about a specific NPC."""
        return [
            r for r in self._rumors.values()
            if r.get("subject") == npc_id
        ]
    
    def create_rumor(
        self,
        subject_id: int,
        content: str,
        rumor_type: str,
        originator_id: int,
        accuracy: float = 0.8,
    ) -> dict:
        """
        Create a new rumor.
        
        Args:
            subject_id: NPC the rumor is about
            content: Rumor content type (romantic, conflict, etc.)
            rumor_type: Type of rumor
            originator_id: NPC who started the rumor
            accuracy: How true the rumor is (0.0 = lie, 1.0 = truth)
        
        Returns:
            The created rumor dict
        """
        rumor = {
            "id": generate_rumor_id(),
            "subject": subject_id,
            "content": content,
            "type": rumor_type,
            "originator": originator_id,
            "known_by": [originator_id],
            "accuracy": accuracy,
            "spread_rate": RUMOR_SPREAD_MODIFIERS["base_rate"],
            "tick_created": self._tick_count,
            "active": True,
        }
        
        self._rumors[rumor["id"]] = rumor
        return rumor
    
    def spread_rumors(
        self,
        npcs: Dict[int, dict],
        locations: Dict[int, dict],
    ) -> List[dict]:
        """
        Spread rumors through the NPC population.
        
        Returns list of NPCs who learned new rumors.
        """
        newly_informed = []
        
        for rumor_id, rumor in self._rumors.items():
            if not rumor.get("active"):
                continue
            
            # Find NPCs who know the rumor
            knowers = set(rumor.get("known_by", []))
            
            # Find potential targets (same location as knowers)
            for knower_id in knowers:
                knower = npcs.get(knower_id)
                if not knower:
                    continue
                
                # Get knower's location
                loc_id = knower.get("current_location")
                if loc_id is None:
                    continue
                
                loc = locations.get(loc_id, {})
                occupants = loc.get("occupant_ids", [])
                
                # Personality affects spread rate
                personality = knower.get("personality", {})
                extraversion = personality.get("extraversion", 0.5)
                gossip_tendency = personality.get("gossip_tendency", 0.5)
                
                spread_mult = (
                    1.0 +
                    extraversion * RUMOR_SPREAD_MODIFIERS["extraversion_mult"] +
                    gossip_tendency * RUMOR_SPREAD_MODIFIERS["gossip_tendency_mult"]
                )
                
                # Apply chaos factor
                spread_mult *= self._chaos_factor
                
                for target_id in occupants:
                    if target_id in knowers:
                        continue
                    
                    target = npcs.get(target_id)
                    if not target:
                        continue
                    
                    # Calculate spread chance
                    spread_chance = rumor.get("spread_rate", 0.1) * spread_mult
                    
                    if random.random() < spread_chance:
                        rumor["known_by"].append(target_id)
                        rumor["accuracy"] *= (1 - RUMOR_SPREAD_MODIFIERS["accuracy_decay"])
                        
                        # Create memory for target
                        self._create_gossip_memory(target, rumor, knower_id)
                        
                        newly_informed.append({
                            "npc_id": target_id,
                            "rumor_id": rumor_id,
                        })
        
        return newly_informed
    
    def _create_gossip_memory(self, npc: dict, rumor: dict, source_id: int):
        """Create a memory of hearing gossip."""
        from .memory_engine import MemoryEngine
        memory_engine = MemoryEngine()
        
        summary = f"Heard a rumor about {rumor.get('subject')}: {rumor.get('content')}"
        
        memory = memory_engine.create_memory(
            memory_type="gossip_heard",
            participants=[source_id, rumor.get("subject")],
            location_id=npc.get("current_location"),
            tick=self._tick_count,
            summary=summary,
            importance_override=0.2,
        )
        
        memory_engine.add_memory_to_npc(npc, memory)
    
    def check_rumor_creation(
        self,
        npcs: Dict[int, dict],
        events: List[dict],
    ) -> List[dict]:
        """
        Check if events should create rumors.
        
        Returns list of created rumors.
        """
        new_rumors = []
        
        for event in events:
            event_type = event.get("type")
            
            # Only certain events create rumors
            if event_type not in ("romantic", "conflict", "betrayal", "breakup"):
                continue
            
            # Find witnesses (NPCs at same location)
            location_id = event.get("location")
            witnesses = [
                npc_id for npc_id, npc in npcs.items()
                if npc.get("current_location") == location_id
                and npc_id not in event.get("participants", [])
            ]
            
            if not witnesses:
                continue
            
            # Random witness might start a rumor
            for witness_id in witnesses:
                witness = npcs.get(witness_id)
                if not witness:
                    continue
                
                gossip_tendency = witness.get("personality", {}).get("gossip_tendency", 0.5)
                
                # Chaos factor increases rumor creation
                creation_chance = 0.1 * gossip_tendency * self._chaos_factor
                
                if random.random() < creation_chance:
                    subject_id = event.get("participants", [])[0] if event.get("participants") else None
                    if subject_id is None:
                        continue
                    
                    rumor = self.create_rumor(
                        subject_id=subject_id,
                        content=event_type,
                        rumor_type=event_type,
                        originator_id=witness_id,
                        accuracy=random.uniform(0.6, 1.0),
                    )
                    new_rumors.append(rumor)
                    break  # One rumor per event
        
        return new_rumors
    
    def apply_rumor_effects(self, npc: dict, rumors: List[dict]) -> dict:
        """
        Apply reputation effects from rumors to an NPC.
        
        Returns summary of effects applied.
        """
        effects = {
            "reputation_change": 0.0,
            "rumors_processed": 0,
        }
        
        for rumor in rumors:
            if rumor.get("subject") != npc.get("id"):
                continue
            
            impact = RUMOR_REPUTATION_IMPACT.get(rumor.get("type"), 0.0)
            accuracy = rumor.get("accuracy", 0.5)
            
            # Apply impact scaled by accuracy
            effects["reputation_change"] += impact * accuracy
            effects["rumors_processed"] += 1
        
        # Apply to NPC reputation
        current_rep = npc.get("reputation", 0.5)
        npc["reputation"] = max(-1.0, min(1.0, current_rep + effects["reputation_change"]))
        
        return effects
    
    # ─── Conflicts ────────────────────────────────────────────────────────────
    
    def get_conflicts(self) -> Dict[str, dict]:
        """Get all conflicts."""
        return self._conflicts
    
    def get_conflicts_for_npc(self, npc_id: int) -> List[dict]:
        """Get all conflicts involving an NPC."""
        return [
            c for c in self._conflicts.values()
            if npc_id in c.get("parties", [])
        ]
    
    def create_conflict(
        self,
        npc_a_id: int,
        npc_b_id: int,
        conflict_type: str,
        cause: str,
        severity: float = 0.5,
    ) -> dict:
        """
        Create a new conflict between two NPCs.
        
        Args:
            npc_a_id: First NPC ID
            npc_b_id: Second NPC ID
            conflict_type: Type of conflict (disagreement, argument, etc.)
            cause: What caused the conflict
            severity: Initial severity (0-1)
        
        Returns:
            The created conflict dict
        """
        conflict = {
            "id": generate_conflict_id(),
            "parties": [npc_a_id, npc_b_id],
            "type": conflict_type,
            "severity": severity,
            "cause": cause,
            "tick_started": self._tick_count,
            "resolution_chance": CONFLICT_RESOLUTION_BASE_CHANCE.get(conflict_type, 0.3),
            "attempts_to_resolve": 0,
            "status": "active",
        }
        
        self._conflicts[conflict["id"]] = conflict
        return conflict
    
    def check_conflict_escalation(
        self,
        conflict: dict,
        npc_a: dict,
        npc_b: dict,
    ) -> Tuple[bool, Optional[str]]:
        """
        Check if a conflict should escalate.
        
        Returns (escalated, new_type).
        """
        current_type = conflict.get("type")
        
        # Get escalation threshold
        threshold = CONFLICT_ESCALATION_THRESHOLDS.get(current_type)
        if not threshold:
            return False, None
        
        # Check trust threshold
        rel_a = npc_a.get("relationships", {}).get(str(npc_b["id"]), {})
        rel_b = npc_b.get("relationships", {}).get(str(npc_a["id"]), {})
        
        avg_trust = (rel_a.get("trust", 0) + rel_b.get("trust", 0)) / 2
        
        if avg_trust > threshold.get("trust_threshold", -0.5):
            return False, None
        
        # Check escalation chance
        escalation_chance = threshold.get("escalation_chance", 0.1)
        
        # Chaos factor increases escalation
        escalation_chance *= self._chaos_factor
        
        # Personality affects escalation
        conflict_tend_a = npc_a.get("personality", {}).get("conflict_tendency", 0.3)
        conflict_tend_b = npc_b.get("personality", {}).get("conflict_tendency", 0.3)
        avg_conflict_tend = (conflict_tend_a + conflict_tend_b) / 2
        
        escalation_chance *= (1 + avg_conflict_tend)
        
        if random.random() < escalation_chance:
            new_type = threshold.get("next_stage")
            if new_type:
                conflict["type"] = new_type
                conflict["severity"] = min(1.0, conflict.get("severity", 0.5) + 0.2)
                conflict["resolution_chance"] = CONFLICT_RESOLUTION_BASE_CHANCE.get(new_type, 0.2)
                return True, new_type
        
        return False, None
    
    def attempt_conflict_resolution(
        self,
        conflict: dict,
        npc_a: dict,
        npc_b: dict,
    ) -> bool:
        """
        Attempt to resolve a conflict.
        
        Returns True if resolved.
        """
        resolution_chance = conflict.get("resolution_chance", 0.3)
        conflict["attempts_to_resolve"] = conflict.get("attempts_to_resolve", 0) + 1
        
        # Forgiveness rates affect resolution
        forgive_a = npc_a.get("personality", {}).get("forgiveness_rate", 0.5)
        forgive_b = npc_b.get("personality", {}).get("forgiveness_rate", 0.5)
        avg_forgive = (forgive_a + forgive_b) / 2
        
        resolution_chance *= (1 + avg_forgive)
        
        # Time passed increases resolution chance
        ticks_passed = self._tick_count - conflict.get("tick_started", 0)
        time_bonus = min(0.2, ticks_passed * 0.001)
        resolution_chance += time_bonus
        
        if random.random() < resolution_chance:
            conflict["status"] = "resolved"
            conflict["tick_resolved"] = self._tick_count
            return True
        
        return False
    
    def check_spontaneous_conflict(
        self,
        npc_a: dict,
        npc_b: dict,
        location_type: str,
    ) -> Optional[dict]:
        """
        Check if a spontaneous conflict should occur.
        
        Returns conflict dict if created, None otherwise.
        """
        # Check relationship
        rel_a = npc_a.get("relationships", {}).get(str(npc_b["id"]), {})
        rel_b = npc_b.get("relationships", {}).get(str(npc_a["id"]), {})
        
        # Low trust = higher conflict chance
        avg_trust = (rel_a.get("trust", 0.3) + rel_b.get("trust", 0.3)) / 2
        
        if avg_trust > 0.2:
            return None
        
        # Calculate conflict chance
        conflict_tend_a = npc_a.get("personality", {}).get("conflict_tendency", 0.3)
        conflict_tend_b = npc_b.get("personality", {}).get("conflict_tendency", 0.3)
        
        base_chance = 0.02
        chance = base_chance * (1 - avg_trust) * (1 + (conflict_tend_a + conflict_tend_b) / 2)
        chance *= self._chaos_factor
        
        if random.random() < chance:
            return self.create_conflict(
                npc_a_id=npc_a["id"],
                npc_b_id=npc_b["id"],
                conflict_type="disagreement",
                cause="spontaneous",
                severity=0.3,
            )
        
        return None
    
    # ─── Romantic Progression ──────────────────────────────────────────────────
    
    def check_romantic_progression(
        self,
        npc_a: dict,
        npc_b: dict,
        rel_a: dict,
        rel_b: dict,
        world_hours_together: float,
        world_hours_delta: float,
    ) -> List[dict]:
        """
        Check for romantic relationship progression.
        
        Returns list of progression events.
        """
        events = []
        
        from .relationship_engine import RelationshipEngine
        rel_engine = RelationshipEngine()
        
        # Get zodiac compatibility
        zodiac_a = npc_a.get("zodiac_index", 0)
        zodiac_b = npc_b.get("zodiac_index", 0)
        zodiac_compat = ZODIAC_COMPATIBILITY[zodiac_a][zodiac_b]
        
        # Check crush formation
        if rel_a.get("type") not in ("crush", "dating", "partner"):
            if rel_engine.check_crush_formation(npc_a, npc_b, rel_a, rel_b, zodiac_compat, world_hours_delta):
                events.append({
                    "type": "crush_formed",
                    "npc_id": npc_a["id"],
                    "target_id": npc_b["id"],
                })
        
        if rel_b.get("type") not in ("crush", "dating", "partner"):
            if rel_engine.check_crush_formation(npc_b, npc_a, rel_b, rel_a, zodiac_compat, world_hours_delta):
                events.append({
                    "type": "crush_formed",
                    "npc_id": npc_b["id"],
                    "target_id": npc_a["id"],
                })
        
        # Check confession (crush -> dating)
        if rel_a.get("type") == "crush" and rel_b.get("type") not in ("dating", "partner"):
            can_confess, success_chance = rel_engine.can_confess(npc_a, npc_b, rel_a, rel_b)
            
            if can_confess:
                # Chaos factor affects confession likelihood. Base: 5% chance per world-hour
                confession_chance = 0.05 * self._chaos_factor * world_hours_delta
                
                if random.random() < confession_chance:
                    success = rel_engine.attempt_confession(npc_a, npc_b, rel_a, rel_b, success_chance)
                    
                    if success:
                        events.append({
                            "type": "confession_success",
                            "npc_id": npc_a["id"],
                            "target_id": npc_b["id"],
                        })
                    else:
                        events.append({
                            "type": "confession_rejected",
                            "npc_id": npc_a["id"],
                            "target_id": npc_b["id"],
                        })
        
        # Check dating -> partner
        if rel_a.get("type") == "dating":
            if rel_engine.check_dating_to_partner(npc_a, npc_b, rel_a, rel_b, world_hours_together, world_hours_delta):
                events.append({
                    "type": "became_partner",
                    "npc_id": npc_a["id"],
                    "target_id": npc_b["id"],
                })
        
        # Check breakup
        breakup = rel_engine.check_breakup(npc_a, npc_b, rel_a, rel_b, self._tick_count, world_hours_delta)
        if breakup:
            rel_engine.execute_breakup(npc_a, npc_b, rel_a, rel_b, breakup)
            events.append({
                "type": "breakup",
                "initiator": breakup.get("initiator"),
                "trigger": breakup.get("trigger"),
                "parties": [npc_a["id"], npc_b["id"]],
            })
        
        return events
    
    # ─── Home Leaving Mechanics ───────────────────────────────────────────────
    
    def check_home_leaving(
        self,
        npc: dict,
        npcs: Dict[int, dict],
        locations: Dict[int, dict],
        world_hours_delta: float,
    ) -> Optional[dict]:
        """
        Check if an NPC should leave their home.
        
        Returns leaving info if should leave, None otherwise.
        """
        home_id = npc.get("home_location")
        if home_id is None:
            return None
        
        personality = npc.get("personality", {})
        
        # Check each trigger
        for trigger_name, trigger_config in HOME_LEAVING_TRIGGERS.items():
            if trigger_name == "hostile_environment":
                housemates = [n for n in npcs.values() if n.get("home_location") == home_id and n["id"] != npc["id"]]
                if housemates:
                    relationships = npc.get("relationships", {})
                    min_trust = 1.0
                    for h in housemates:
                        rel_data = relationships.get(str(h["id"])) or {}
                        trust = rel_data.get("trust", 0.5) if isinstance(rel_data, dict) else (rel_data - 0.3)
                        if trust < min_trust: min_trust = trust
                    
                    if min_trust < trigger_config.get("min_relationship_with_all_housemates", 0.15):
                        chance = trigger_config.get("chance", 0.0) * self._chaos_factor * world_hours_delta
                        if random.random() < chance:
                            return {"trigger": "hostile_environment", "old_home": home_id}
            
            elif trigger_name == "unresolved_conflict":
                conflicts = [c for c in self.get_conflicts_for_npc(npc["id"]) if c.get("status") == "active"]
                for conflict in conflicts:
                    if conflict.get("severity", 0) >= trigger_config.get("conflict_severity_threshold", 0.6):
                        other_id = [p for p in conflict.get("parties", []) if p != npc["id"]][0]
                        other = npcs.get(other_id)
                        if other and other.get("home_location") == home_id:
                            chance = trigger_config.get("chance", 0.0) * self._chaos_factor * world_hours_delta
                            if random.random() < chance:
                                return {"trigger": "unresolved_conflict", "old_home": home_id}
            
            elif trigger_name == "breakup_shared_home":
                housemates = [n for n in npcs.values() if n.get("home_location") == home_id and n["id"] != npc["id"]]
                relationships = npc.get("relationships", {})
                for h in housemates:
                    rel_data = relationships.get(str(h["id"])) or {}
                    if isinstance(rel_data, dict) and rel_data.get("type") == "ex":
                        chance = trigger_config.get("chance", 0.0) * self._chaos_factor * world_hours_delta
                        if random.random() < chance:
                            return {"trigger": "breakup_shared_home", "old_home": home_id}

            elif trigger_name == "financial_opportunity":
                housemates = [n for n in npcs.values() if n.get("home_location") == home_id and n["id"] != npc["id"]]
                # Only leave for opportunity if they are alone and have plenty of money
                if not housemates and npc.get("money", 0) >= trigger_config.get("money_threshold", 500.0):
                    chance = trigger_config.get("chance", 0.0) * self._chaos_factor * world_hours_delta
                    if random.random() < chance:
                        return {"trigger": "financial_opportunity", "old_home": home_id}
            
            elif trigger_name == "wanderlust":
                if personality.get("conscientiousness", 0.5) < trigger_config.get("conscientiousness_threshold", 0.2):
                    chance = trigger_config.get("chance", 0.0) * self._chaos_factor * world_hours_delta
                    if random.random() < chance:
                        return {"trigger": "wanderlust", "old_home": home_id}
        
        return None
    
    # ─── Random Shock Events ──────────────────────────────────────────────────
    
    def check_random_shocks(self) -> List[dict]:
        """
        Check for random shock events.
        
        Returns list of shock events that occurred.
        """
        shocks = []
        
        for event_name, event_config in RANDOM_SHOCK_EVENTS.items():
            base_chance = event_config.get("chance_per_tick", 0)
            chance = base_chance * self._chaos_factor
            
            if random.random() < chance:
                shock = {
                    "type": event_name,
                    "chaos_boost": event_config.get("chaos_boost", 0.1),
                    "tick": self._tick_count,
                }
                
                if event_name == "economic_crisis":
                    shock["duration"] = event_config.get("duration_ticks", 100)
                
                shocks.append(shock)
                
                # Inject chaos
                self.inject_chaos(event_config.get("chaos_boost", 0.1))
        
        return shocks
    
    # ─── Serialization ────────────────────────────────────────────────────────
    
    def get_state(self) -> dict:
        """Get state for serialization."""
        return {
            "groups": copy.deepcopy(self._groups),
            "rumors": copy.deepcopy(self._rumors),
            "conflicts": copy.deepcopy(self._conflicts),
            "chaos_factor": self._chaos_factor,
        }
    
    def load_state(self, state: dict):
        """Load state from serialization."""
        self._groups = state.get("groups", {})
        self._rumors = state.get("rumors", {})
        self._conflicts = state.get("conflicts", {})
        self._chaos_factor = state.get("chaos_factor", CHAOS_FACTOR_CONFIG["initial_chaos"])
