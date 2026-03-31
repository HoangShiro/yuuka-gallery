"""
Time skip functionality for x1000 speed mode.
This module contains methods for calculating final states directly without simulating each tick.
"""

import random
from .constants import (
    WORLD_SECONDS_PER_REAL_SECOND_AT_X1,
    NEED_INCREASE_RATE,
    TIME_BASED_NEED_MULTIPLIER,
    ACTIVITY_DURATION_WORLD_HOURS,
    ACTIVITY_NEED_REDUCTION,
    WORK_WAGES,
    FOOD_PRICES,
    SOCIAL_AFFINITY_GAIN_EXTROVERTED,
    SOCIAL_AFFINITY_GAIN_INTROVERTED,
    SOCIAL_AFFINITY_LOSS_EXTROVERTED,
    SOCIAL_AFFINITY_LOSS_INTROVERTED,
    ZODIAC_COMPATIBILITY,
)

class TimeSkipMixin:
    """Mixin class providing time skip functionality for WorldStateEngine."""
    
    def _perform_time_skip(self, delta_seconds):
        """Perform time skip calculation for x1000 speed mode."""
        
        # Calculate world time advancement
        skip_hours = (delta_seconds * WORLD_SECONDS_PER_REAL_SECOND_AT_X1 * 1000) / 3600.0
        skip_days = skip_hours / 24.0
        
        # Advance world time
        self._world_seconds += delta_seconds * WORLD_SECONDS_PER_REAL_SECOND_AT_X1 * 1000
        self._tick_count += int(skip_hours * 4)  # Approximate tick count
        
        # Process daily financial updates for each day skipped
        for _ in range(int(skip_days)):
            for npc in self._npcs.values():
                fin = npc.get("financial_plan", {})
                if npc.get("money", 0.0) < fin.get("last_daily_balance", 0.0):
                    fin["prioritize_work"] = True
                else:
                    fin["prioritize_work"] = False
                fin["last_daily_balance"] = npc.get("money", 0.0)
        
        # Process needs, activities and relationships
        self._skip_needs_progression(skip_hours)
        self._skip_activities_resolution(skip_hours)
        self._skip_relationship_progression(skip_hours)
        self._update_birth_events()
        self._maintain_construction_system()
        
        # Complete all movements instantly
        for npc in self._npcs.values():
            if npc.get("movement", {}).get("active"):
                target = npc["movement"]["target_location"]
                npc["current_location"] = target
                npc["movement"]["active"] = False
                npc["_arrived_this_tick"] = True
                self._add_npc_to_location(npc, target)

        # Progress social pairs
        for npc in self._npcs.values():
            if npc.get("social_pair"):
                self._handle_npc_social_progression(npc, skip_hours)

        # Social pair resolution can schedule births; in time-skip mode those births
        # should also resolve immediately if their due time is already within this window.
        self._update_birth_events()

        # Handle state transitions for NPCs that finished their stay or just arrived
        for npc in self._npcs.values():
            if npc.get("social_pair"):
                continue # Social interactions are handled by _handle_npc_social_progression
                
            # If their stay time has passed or they just arrived, pick new goal
            stay_until = npc.get("_stay_until_world_sec", 0)
            if self._world_seconds >= stay_until or npc.pop("_arrived_this_tick", False):
                activity = self._choose_activity(npc)
                npc["activity"] = activity
                location_id = self._choose_location(npc, activity)
                
                if location_id is not None and location_id != npc["current_location"]:
                    # In x1000, begin_npc_movement calls complete_npc_movement immediately 
                    # due to high simulation speed, so the NPC teleports to destination
                    self._begin_npc_movement(npc, location_id, activity)
                else:
                    # Stay at current location with new activity
                    duration_h = ACTIVITY_DURATION_WORLD_HOURS.get(activity, 1.0)
                    if activity == "sleep":
                        current_hour = int(self._world_seconds % (24 * 3600)) // 3600
                        if 6 <= current_hour < 22:
                            duration_h = 1.0
                    
                    duration_h *= random.uniform(0.8, 1.2)
                    npc["_stay_until_world_sec"] = self._world_seconds + duration_h * 3600.0
                    npc["_arrived_this_tick"] = False
                    
        # Check for new interactions (socializing).
        # Road interactions are impossible here because time-skip resolves movement instantly.
        self._check_location_interactions()
        self._tick_count += 1

    def _skip_needs_progression(self, skip_hours):
        """Calculate needs evolution during time skip."""
        for npc in self._npcs.values():
            needs = npc["needs"]
            
            # Calculate work need based on financial situation
            money = npc.get("money", 0.0)
            fin = npc.get("financial_plan", {})
            target = fin.get("target_balance", 200.0)
            deficit = max(0.0, target - money) / max(1.0, target)
            work_increase_base = deficit * 0.1
            if fin.get("prioritize_work"):
                work_increase_base *= 2.0
            
            # Apply time-based multipliers for the skip duration
            current_hour = int(self._world_seconds % (24 * 3600)) // 3600
            
            for need, base_rate in NEED_INCREASE_RATE.items():
                if need == "work":
                    # Work need calculation
                    work_multiplier = 1.0
                    for start_h, end_h, mult in TIME_BASED_NEED_MULTIPLIER.get("work", []):
                        if start_h <= current_hour < end_h:
                            work_multiplier = mult
                            break
                    needs["work"] = max(0.0, min(1.0, needs.get("work", 0.0) + work_increase_base * work_multiplier * skip_hours))
                else:
                    # Other needs calculation
                    multiplier = 1.0
                    for start_h, end_h, mult in TIME_BASED_NEED_MULTIPLIER.get(need, []):
                        if start_h <= current_hour < end_h:
                            multiplier = mult
                            break
                    needs[need] = max(0.0, min(1.0, needs.get(need, 0.0) + base_rate * multiplier * skip_hours))

    def _skip_activities_resolution(self, skip_hours):
        """Complete activities during time skip."""
        for npc in self._npcs.values():
            activity = npc.get("activity", "idle")
            if activity == "idle":
                continue
                
            # Calculate activity completion
            activity_duration = ACTIVITY_DURATION_WORLD_HOURS.get(activity, 1.0)
            completion_ratio = min(1.0, skip_hours / activity_duration)
            
            # Apply need reduction based on completion
            reductions = ACTIVITY_NEED_REDUCTION.get(activity)
            if reductions:
                needs = npc["needs"]
                for need_key, reduction_rate in reductions:
                    if need_key in needs:
                        reduction = reduction_rate * activity_duration * completion_ratio
                        needs[need_key] = max(0.0, min(1.0, needs[need_key] + reduction))
            
            # Handle work income
            if activity == "work":
                loc = self._locations.get(npc.get("current_location", -1), {})
                loc_type = loc.get("type")
                effective_hours = activity_duration * completion_ratio
                wage_key = loc_type
                if loc_type == "construction_site" and npc.get("job_type") == "builder_hq":
                    wage_key = "builder_hq"
                wage = WORK_WAGES.get(wage_key, 0.0)
                npc["money"] = npc.get("money", 0.0) + wage * effective_hours
                if loc_type == "construction_site" and npc.get("job_type") == "builder_hq":
                    loc["construction_progress_hours"] = loc.get("construction_progress_hours", 0.0) + effective_hours
                    loc["construction_status"] = "building"
                    if loc.get("construction_progress_hours", 0.0) >= loc.get("construction_required_hours", float("inf")):
                        self._complete_construction_site(loc["id"])
            
            # Handle food expenses
            if activity == "eat":
                loc = self._locations.get(npc.get("current_location", -1), {})
                loc_type = loc.get("type")
                price = FOOD_PRICES.get(loc_type, 0.0)
                npc["money"] = max(0.0, npc.get("money", 0.0) - price * activity_duration * completion_ratio)

    def _skip_relationship_progression(self, skip_hours):
        """Calculate relationship changes during time skip."""
        # Estimate social interactions
        social_cycles = int(skip_hours / 2.0)  # Socialize takes 2 hours
        
        for npc in self._npcs.values():
            # Calculate interaction opportunities
            extroverted = npc.get("financial_plan", {}).get("extroverted_finance", False)
            personality_factor = 1.5 if extroverted else 0.7
            estimated_interactions = min(social_cycles, int(skip_hours * personality_factor * 0.3))
            
            if estimated_interactions <= 0:
                continue
            
            # Find potential partners
            current_loc = npc.get("current_location")
            partners = []
            
            # Priority 1: Current location occupants
            if current_loc:
                loc = self._locations.get(current_loc, {})
                for occupant_id in loc.get("occupant_ids", []):
                    if occupant_id != npc["id"] and occupant_id in self._npcs:
                        partners.append(occupant_id)
            
            # Limit interactions
            partners = partners[:estimated_interactions]
            
            # Process each interaction
            for partner_id in partners:
                if partner_id not in self._npcs:
                    continue
                    
                partner = self._npcs[partner_id]
                
                # Calculate relationship change
                compat = ZODIAC_COMPATIBILITY[npc.get("zodiac_index", 0)][partner.get("zodiac_index", 0)]
                success = random.random() < compat
                
                relationships = npc.setdefault("relationships", {})
                partner_str_id = str(partner_id)
                current_rel = relationships.get(partner_str_id, 0.3)
                
                if success:
                    gain = SOCIAL_AFFINITY_GAIN_EXTROVERTED if extroverted else SOCIAL_AFFINITY_GAIN_INTROVERTED
                    relationships[partner_str_id] = min(1.0, current_rel + gain)
                    npc["needs"]["social"] = max(0.0, npc["needs"].get("social", 0.0) - 0.5)
                else:
                    loss = SOCIAL_AFFINITY_LOSS_EXTROVERTED if extroverted else SOCIAL_AFFINITY_LOSS_INTROVERTED
                    relationships[partner_str_id] = max(0.0, current_rel - loss)
                
                # Update interaction cooldowns
                npc["last_location_interaction_tick"] = self._tick_count
                npc["last_road_interaction_tick"] = self._tick_count
                
                # Apply symmetric changes to partner
                partner_relationships = partner.setdefault("relationships", {})
                npc_str_id = str(npc["id"])
                partner_current_rel = partner_relationships.get(npc_str_id, 0.3)
                partner_extroverted = partner.get("financial_plan", {}).get("extroverted_finance", False)
                
                if success:
                    partner_gain = SOCIAL_AFFINITY_GAIN_EXTROVERTED if partner_extroverted else SOCIAL_AFFINITY_GAIN_INTROVERTED
                    partner_relationships[npc_str_id] = min(1.0, partner_current_rel + partner_gain)
                    partner["needs"]["social"] = max(0.0, partner["needs"].get("social", 0.0) - 0.5)
                else:
                    partner_loss = SOCIAL_AFFINITY_LOSS_EXTROVERTED if partner_extroverted else SOCIAL_AFFINITY_LOSS_INTROVERTED
                    partner_relationships[npc_str_id] = max(0.0, partner_current_rel - partner_loss)
                
                partner["last_location_interaction_tick"] = self._tick_count
                partner["last_road_interaction_tick"] = self._tick_count
