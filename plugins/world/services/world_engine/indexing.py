import math

from ..pathfinder import Pathfinder


def build_location_index(map_data):
    locations_list = map_data.get("locations", [])
    locations = {loc["id"]: loc for loc in locations_list}
    for loc in locations.values():
        loc.setdefault("occupant_ids", [])

    loc_edges = map_data.get("roads", [])
    if loc_edges:
        pathfinder = Pathfinder(locations_list, loc_edges)
        return locations, pathfinder

    edges = []
    added = set()

    def add_edge(left_idx, right_idx):
        key = (min(left_idx, right_idx), max(left_idx, right_idx))
        if key in added:
            return
        added.add(key)
        edges.append(
            {
                "from": locations_list[left_idx]["id"],
                "to": locations_list[right_idx]["id"],
                "curvature": 0,
            }
        )

    for left_idx in range(len(locations_list)):
        for right_idx in range(left_idx + 1, len(locations_list)):
            left = locations_list[left_idx]
            right = locations_list[right_idx]
            dist = math.hypot(left["x"] - right["x"], left["y"] - right["y"])
            if dist < 200:
                add_edge(left_idx, right_idx)

    pathfinder = Pathfinder(locations_list, edges)
    return locations, pathfinder


def calc_world_time(world_seconds):
    total_minutes = int(max(0.0, float(world_seconds)) // 60)
    day = total_minutes // (24 * 60) + 1
    hour = (total_minutes % (24 * 60)) // 60
    minute = total_minutes % 60
    return f"Day {day}, {hour:02d}:{minute:02d}"
