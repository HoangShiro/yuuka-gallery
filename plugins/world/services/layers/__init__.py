"""
Layer module for world generation engine.

This module contains helper utilities used across all generation layers.
"""

import math


def closest_point_on_polyline(px, py, pts):
    """Find closest point on a polyline to a given point.
    
    Args:
        px (float): Query point X coordinate
        py (float): Query point Y coordinate
        pts (list): List of {"x": int, "y": int} polyline points
    
    Returns:
        tuple: (closest_x, closest_y, distance)
    """
    if not pts or len(pts) < 2:
        if pts:
            return (pts[0]["x"], pts[0]["y"], math.hypot(px - pts[0]["x"], py - pts[0]["y"]))
        return (px, py, 0.0)
    
    min_dist = float('inf')
    closest_x = px
    closest_y = py
    
    # Check each line segment
    for i in range(len(pts) - 1):
        p1 = pts[i]
        p2 = pts[i + 1]
        
        # Vector from p1 to p2
        dx = p2["x"] - p1["x"]
        dy = p2["y"] - p1["y"]
        
        # If segment is a point
        if dx == 0 and dy == 0:
            dist = math.hypot(px - p1["x"], py - p1["y"])
            if dist < min_dist:
                min_dist = dist
                closest_x = p1["x"]
                closest_y = p1["y"]
            continue
        
        # Parameter t for closest point on line segment
        # Project point onto line, clamp to [0, 1] for segment
        t = max(0, min(1, ((px - p1["x"]) * dx + (py - p1["y"]) * dy) / (dx * dx + dy * dy)))
        
        # Closest point on this segment
        seg_x = p1["x"] + t * dx
        seg_y = p1["y"] + t * dy
        
        # Distance to this point
        dist = math.hypot(px - seg_x, py - seg_y)
        
        if dist < min_dist:
            min_dist = dist
            closest_x = seg_x
            closest_y = seg_y
    
    return (closest_x, closest_y, min_dist)


def road_angle_at_point(pt_x, pt_y, pts):
    """Calculate road angle in radians at the closest point on polyline.
    
    Args:
        pt_x (float): Query point X coordinate
        pt_y (float): Query point Y coordinate
        pts (list): List of {"x": int, "y": int} polyline points
    
    Returns:
        float: Angle in radians of the road segment closest to the point
    """
    if not pts or len(pts) < 2:
        return 0.0
    
    # Find the segment containing the closest point
    min_dist = float('inf')
    best_segment_idx = 0
    
    for i in range(len(pts) - 1):
        p1 = pts[i]
        p2 = pts[i + 1]
        
        dx = p2["x"] - p1["x"]
        dy = p2["y"] - p1["y"]
        
        if dx == 0 and dy == 0:
            dist = math.hypot(pt_x - p1["x"], pt_y - p1["y"])
        else:
            t = max(0, min(1, ((pt_x - p1["x"]) * dx + (pt_y - p1["y"]) * dy) / (dx * dx + dy * dy)))
            seg_x = p1["x"] + t * dx
            seg_y = p1["y"] + t * dy
            dist = math.hypot(pt_x - seg_x, pt_y - seg_y)
        
        if dist < min_dist:
            min_dist = dist
            best_segment_idx = i
    
    # Calculate angle of the best segment
    p1 = pts[best_segment_idx]
    p2 = pts[best_segment_idx + 1]
    
    dx = p2["x"] - p1["x"]
    dy = p2["y"] - p1["y"]
    
    return math.atan2(dy, dx)


def check_building_overlap(bx, by, bw, bh, existing, gap=8):
    """Check if a building bounding box overlaps with existing buildings.
    
    Args:
        bx (int): Top-left X coordinate of new building
        by (int): Top-left Y coordinate of new building
        bw (int): Width of new building
        bh (int): Height of new building
        existing (list): List of existing location dicts with bx, by, bw, bh
        gap (int): Minimum gap between buildings (default: 8)
    
    Returns:
        bool: True if overlap detected, False if placement is valid
    """
    for loc in existing:
        # Check if bounding boxes overlap (with gap)
        if not (bx + bw + gap <= loc["bx"] or
                bx >= loc["bx"] + loc["bw"] + gap or
                by + bh + gap <= loc["by"] or
                by >= loc["by"] + loc["bh"] + gap):
            return True
    
    return False


def random_normal_int(rng, lo, hi, peak):
    """Generate integer with normal distribution centered at peak.
    
    Uses Box-Muller transform to approximate normal distribution.
    
    Args:
        rng (random.Random): Seeded random number generator
        lo (int): Minimum value (inclusive)
        hi (int): Maximum value (inclusive)
        peak (int): Peak of distribution
    
    Returns:
        int: Random integer in [lo, hi] with normal distribution
    """
    # Box-Muller transform to generate normal distribution
    u1 = rng.random()
    u2 = rng.random()
    
    # Avoid log(0)
    if u1 < 1e-10:
        u1 = 1e-10
    
    # Standard normal (mean=0, stddev=1)
    z = math.sqrt(-2.0 * math.log(u1)) * math.cos(2.0 * math.pi * u2)
    
    # Scale to range with peak as center
    # Use stddev = (hi - lo) / 6 so ~99.7% of values fall within range
    stddev = (hi - lo) / 6.0
    value = peak + z * stddev
    
    # Clamp to [lo, hi] and round
    return int(max(lo, min(hi, round(value))))
