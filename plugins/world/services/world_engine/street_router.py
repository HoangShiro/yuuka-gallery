import heapq
import math


def _point_distance(left, right):
    return math.hypot(left["x"] - right["x"], left["y"] - right["y"])


def _coord_key(point):
    return (round(float(point["x"]), 3), round(float(point["y"]), 3))


def _segment_vector(start, end):
    return end["x"] - start["x"], end["y"] - start["y"]


def _point_on_segment_t(point, start, end, tolerance=2.0):
    dx, dy = _segment_vector(start, end)
    length_sq = dx * dx + dy * dy
    if length_sq <= 1e-9:
        return None
    t = ((point["x"] - start["x"]) * dx + (point["y"] - start["y"]) * dy) / length_sq
    if t < -0.01 or t > 1.01:
        return None
    t = max(0.0, min(1.0, t))
    closest = {
        "x": start["x"] + dx * t,
        "y": start["y"] + dy * t,
    }
    if _point_distance(point, closest) > tolerance:
        return None
    return t


def _segment_intersection(left_start, left_end, right_start, right_end):
    left_dx, left_dy = _segment_vector(left_start, left_end)
    right_dx, right_dy = _segment_vector(right_start, right_end)
    cross = left_dx * right_dy - left_dy * right_dx
    if abs(cross) <= 1e-9:
        intersections = []
        for point in (left_start, left_end, right_start, right_end):
            left_t = _point_on_segment_t(point, left_start, left_end, tolerance=0.5)
            right_t = _point_on_segment_t(point, right_start, right_end, tolerance=0.5)
            if left_t is not None and right_t is not None:
                intersections.append((left_t, right_t, {"x": point["x"], "y": point["y"]}))
        dedup = {}
        for left_t, right_t, point in intersections:
            dedup[_coord_key(point)] = (left_t, right_t, point)
        return list(dedup.values())

    qmp_x = right_start["x"] - left_start["x"]
    qmp_y = right_start["y"] - left_start["y"]
    left_t = (qmp_x * right_dy - qmp_y * right_dx) / cross
    right_t = (qmp_x * left_dy - qmp_y * left_dx) / cross
    if -1e-6 <= left_t <= 1.0 + 1e-6 and -1e-6 <= right_t <= 1.0 + 1e-6:
        left_t = max(0.0, min(1.0, left_t))
        right_t = max(0.0, min(1.0, right_t))
        point = {
            "x": left_start["x"] + left_dx * left_t,
            "y": left_start["y"] + left_dy * left_t,
        }
        return [(left_t, right_t, point)]
    return []


class StreetRouter:
    """Build a routable graph from street polylines and building frontages."""

    def __init__(self, map_data):
        self._graph = {}
        self._nodes = {}
        self._location_frontages = {}
        self._route_cache = {}
        self._build(map_data or {})

    def _build(self, map_data):
        streets = [
            street
            for street in map_data.get("streets", [])
            if street.get("tier") in {"arterial", "local"} and len(street.get("pts", [])) >= 2
        ]
        locations = list(map_data.get("locations", []))
        segments = []
        breakpoints = {}
        frontage_nodes = []

        for street_index, street in enumerate(streets):
            pts = street["pts"]
            for seg_index in range(len(pts) - 1):
                start = {"x": float(pts[seg_index]["x"]), "y": float(pts[seg_index]["y"])}
                end = {"x": float(pts[seg_index + 1]["x"]), "y": float(pts[seg_index + 1]["y"])}
                segment_id = len(segments)
                segments.append(
                    {
                        "id": segment_id,
                        "street_index": street_index,
                        "tier": street["tier"],
                        "start": start,
                        "end": end,
                    }
                )
                breakpoints[segment_id] = [
                    (0.0, start),
                    (1.0, end),
                ]

        for left_idx in range(len(segments)):
            left = segments[left_idx]
            for right_idx in range(left_idx + 1, len(segments)):
                right = segments[right_idx]
                for left_t, right_t, point in _segment_intersection(
                    left["start"],
                    left["end"],
                    right["start"],
                    right["end"],
                ):
                    breakpoints[left["id"]].append((left_t, point))
                    breakpoints[right["id"]].append((right_t, point))

        for loc in locations:
            loc_frontages = []
            for frontage in loc.get("frontages", []):
                road_point = frontage.get("roadPt")
                edge_point = frontage.get("edgePt")
                if not road_point or not edge_point:
                    continue
                best = None
                for segment in segments:
                    t = _point_on_segment_t(road_point, segment["start"], segment["end"], tolerance=2.5)
                    if t is None:
                        continue
                    snapped = {
                        "x": segment["start"]["x"] + (segment["end"]["x"] - segment["start"]["x"]) * t,
                        "y": segment["start"]["y"] + (segment["end"]["y"] - segment["start"]["y"]) * t,
                    }
                    dist = _point_distance(road_point, snapped)
                    if best is None or dist < best["dist"]:
                        best = {
                            "segment": segment,
                            "t": t,
                            "point": snapped,
                            "dist": dist,
                        }
                if best is None:
                    continue
                breakpoints[best["segment"]["id"]].append((best["t"], best["point"]))
                frontage_copy = dict(frontage)
                frontage_copy["roadPt"] = {
                    "x": float(best["point"]["x"]),
                    "y": float(best["point"]["y"]),
                }
                frontage_copy["edgePt"] = {
                    "x": float(edge_point["x"]),
                    "y": float(edge_point["y"]),
                }
                frontage_copy["location_id"] = loc["id"]
                loc_frontages.append(frontage_copy)
                frontage_nodes.append(frontage_copy)
            self._location_frontages[loc["id"]] = loc_frontages

        def ensure_node(point):
            key = _coord_key(point)
            node = self._nodes.get(key)
            if node is None:
                node = {"id": key, "x": float(point["x"]), "y": float(point["y"])}
                self._nodes[key] = node
                self._graph[key] = []
            return node["id"]

        for segment in segments:
            points = {}
            for t, point in breakpoints[segment["id"]]:
                rounded_t = round(float(t), 6)
                points[rounded_t] = {"x": float(point["x"]), "y": float(point["y"])}
            ordered = sorted(points.items(), key=lambda item: item[0])
            for idx in range(len(ordered) - 1):
                left_point = ordered[idx][1]
                right_point = ordered[idx + 1][1]
                dist = _point_distance(left_point, right_point)
                if dist <= 1e-6:
                    continue
                left_id = ensure_node(left_point)
                right_id = ensure_node(right_point)
                self._graph[left_id].append((right_id, dist, segment["tier"]))
                self._graph[right_id].append((left_id, dist, segment["tier"]))

        for frontage in frontage_nodes:
            frontage["node_id"] = ensure_node(frontage["roadPt"])

    def get_location_frontages(self, location_id):
        return list(self._location_frontages.get(location_id, []))

    def _shortest_path(self, start_node, end_node):
        if start_node == end_node:
            return 0.0, [start_node]
        heap = [(0.0, start_node)]
        distances = {start_node: 0.0}
        previous = {}
        while heap:
            dist, node = heapq.heappop(heap)
            if node == end_node:
                break
            if dist > distances.get(node, float("inf")):
                continue
            for neighbor, edge_dist, _tier in self._graph.get(node, []):
                next_dist = dist + edge_dist
                if next_dist >= distances.get(neighbor, float("inf")):
                    continue
                distances[neighbor] = next_dist
                previous[neighbor] = node
                heapq.heappush(heap, (next_dist, neighbor))
        if end_node not in distances:
            return None, None
        path = [end_node]
        cursor = end_node
        while cursor != start_node:
            cursor = previous[cursor]
            path.append(cursor)
        path.reverse()
        return distances[end_node], path

    def route_between_locations(self, from_location_id, to_location_id):
        cache_key = (int(from_location_id), int(to_location_id))
        if cache_key in self._route_cache:
            return self._route_cache[cache_key]

        from_frontages = self.get_location_frontages(from_location_id)
        to_frontages = self.get_location_frontages(to_location_id)
        if not from_frontages or not to_frontages:
            return None

        best = None
        for source in from_frontages:
            for target in to_frontages:
                road_distance, node_path = self._shortest_path(source["node_id"], target["node_id"])
                if road_distance is None:
                    continue
                total_distance = road_distance + _point_distance(source["edgePt"], source["roadPt"]) + _point_distance(
                    target["roadPt"], target["edgePt"]
                )
                if best is None or total_distance < best["distance_px"]:
                    path_points = [dict(source["edgePt"]), dict(source["roadPt"])]
                    for node_id in node_path[1:-1]:
                        node = self._nodes[node_id]
                        path_points.append({"x": node["x"], "y": node["y"]})
                    path_points.extend([dict(target["roadPt"]), dict(target["edgePt"])])

                    dedup = []
                    for point in path_points:
                        if dedup and _point_distance(dedup[-1], point) <= 1e-6:
                            continue
                        dedup.append(point)

                    best = {
                        "from_location": int(from_location_id),
                        "to_location": int(to_location_id),
                        "source_frontage": dict(source),
                        "target_frontage": dict(target),
                        "route_points": dedup,
                        "distance_px": float(total_distance),
                    }

        self._route_cache[cache_key] = best
        return best


def build_street_router(map_data):
    return StreetRouter(map_data)
