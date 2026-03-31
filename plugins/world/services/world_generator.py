"""
World generation engine for the World plugin.

This module implements the rebuild spec as a strict sequential pipeline while
remaining compatible with the older frontend/engine config shape.
"""

from __future__ import annotations

import math
import random
import time

from .layers import (
    check_building_overlap,
    closest_point_on_polyline,
    random_normal_int,
    road_angle_at_point,
)


FUNCTIONAL_TYPES = ("cafe", "shop", "park", "shrine", "school", "library", "gym", "arcade", "hospital", "office", "factory", "studio", "museum", "cinema")
HOUSE_BASE_SIZE = (28, 22)
BUILDING_FOOTPRINTS = {
    "house": (1, 1),
    "cafe": (2, 1),
    "shop": (2, 1),
    "park": (2, 2),
    "shrine": (1, 1),
    "school": (3, 2),
    "library": (2, 2),
    "gym": (2, 2),
    "arcade": (2, 2),
    "hospital": (3, 2),
    "office": (2, 2),
    "factory": (3, 3),
    "studio": (2, 1),
    "builder_hq": (2, 2),
    "museum": (3, 2),
    "cinema": (3, 2),
}
BUILDING_SIZES = {
    building_type: (
        HOUSE_BASE_SIZE[0] * footprint[0],
        HOUSE_BASE_SIZE[1] * footprint[1],
    )
    for building_type, footprint in BUILDING_FOOTPRINTS.items()
}
BUILDING_SIZES["park"] = (56, 56)
FIXED_CAPACITY = {
    "cafe": 12,
    "shop": 15,
    "park": 30,
    "shrine": 10,
    "school": 25,
    "library": 20,
    "gym": 15,
    "arcade": 25,
    "hospital": 30,
    "office": 20,
    "factory": 30,
    "studio": 10,
    "builder_hq": 12,
    "museum": 24,
    "cinema": 28,
}
VALID_PERSONALITIES = {"Balanced", "Introverted", "Extroverted"}
LAYER_SEQUENCE = (
    ("house count calculation", "_calculate_house_count"),
    ("functional building count calculation", "_calculate_functional_building_counts"),
    ("map size calculation", "_calculate_map_size"),
    ("main road generation", "_generate_main_roads"),
    ("sub road generation", "_generate_sub_roads"),
    ("road transformation", "_apply_road_transformations"),
    ("functional building placement", "_place_functional_buildings"),
    ("house placement", "_place_houses"),
    ("mid-block road connection", "_connect_roads_between_buildings"),
    ("building-road connection", "_connect_buildings_to_roads"),
    ("unused road cleanup", "_cleanup_unused_roads"),
    ("connectivity verification", "_verify_connectivity"),
    ("building count verification", "_verify_building_counts"),
    ("district block layout", "_build_district_layout"),
    ("location graph construction", "_build_location_graph"),
    ("npc spawn assignment", "_assign_npc_spawns"),
    ("shape assignment", "_assign_shapes"),
)


class WorldGenerator:
    """Procedural world generator driven by a strict sequential pipeline."""

    def __init__(self, config: dict | None):
        if config is None:
            config = {}
        if not isinstance(config, dict):
            raise TypeError("config must be a dict")

        self.raw_config = dict(config)
        self.npc_count = self._read_int(config, ("npcCount",), 50, 1, 500)
        self.personality = self._normalize_personality(config.get("personality", "Balanced"))
        self.main_road_count = self._read_float(config, ("mainRoadCount", "arterialCount"), 2.0, 1.0, 5.0)
        self.sub_road_count = self._read_int(config, ("subRoadCount",), 8, 0, 50)
        self.road_skew = self._read_float(config, ("roadSkew",), 0.0, 0.0, 1.0)
        self.road_curve = self._read_int(config, ("roadCurve",), 0, 0, 5)
        self.building_density = self._normalize_density(config)

        seed = config.get("seed")
        if seed is None:
            seed = int(time.time() * 1000)
        else:
            seed = self._coerce_int(seed, "seed")
        self.seed = seed
        self.rng = random.Random(seed)

        self.map_size = 0
        self.building_counts: dict[str, int] = {}
        self.streets: list[dict] = []
        self.locations: list[dict] = []
        self.roads: list[dict] = []
        self.npc_spawns: list[dict] = []
        self.districts: list[dict] = []
        self.city_blocks: list[dict] = []
        self.pad = 20
        self._next_location_id = 0
        self._current_layer = None
        self._occupied_grid: set[tuple[int, int]] = set()

    @staticmethod
    def _coerce_int(value, field_name: str) -> int:
        try:
            return int(value)
        except (TypeError, ValueError) as exc:
            raise TypeError(f"{field_name} must be an integer") from exc

    @staticmethod
    def _coerce_float(value, field_name: str) -> float:
        try:
            return float(value)
        except (TypeError, ValueError) as exc:
            raise TypeError(f"{field_name} must be a number") from exc

    @classmethod
    def _read_int(cls, config: dict, keys: tuple[str, ...], default: int, lo: int, hi: int) -> int:
        for key in keys:
            if key in config and config[key] is not None:
                return max(lo, min(hi, cls._coerce_int(config[key], key)))
        return default

    @classmethod
    def _read_float(
        cls, config: dict, keys: tuple[str, ...], default: float, lo: float, hi: float
    ) -> float:
        for key in keys:
            if key in config and config[key] is not None:
                return max(lo, min(hi, cls._coerce_float(config[key], key)))
        return default

    @staticmethod
    def _normalize_personality(value) -> str:
        if isinstance(value, str):
            normalized = value.strip().capitalize()
            if normalized in VALID_PERSONALITIES:
                return normalized
            mapping = {
                "social": "Extroverted",
                "calm": "Introverted",
                "nature": "Introverted",
            }
            return mapping.get(value.strip().lower(), "Balanced")

        if isinstance(value, dict):
            social = float(value.get("social", 0.5))
            calm = float(value.get("calm", 0.5))
            nature = float(value.get("nature", 0.5))
            if social >= calm + 0.12 and social >= nature + 0.12:
                return "Extroverted"
            if calm >= social + 0.12 or nature >= social + 0.18:
                return "Introverted"
            return "Balanced"

        return "Balanced"

    @staticmethod
    def _normalize_density(config: dict) -> str:
        value = config.get("buildingDensity")
        if isinstance(value, str):
            normalized = value.strip().capitalize()
            mapping = {
                "Sparse": "Scattered",
                "Even": "Uniform",
                "Clustered": "Concentrated",
                "Scattered": "Scattered",
                "Uniform": "Uniform",
                "Concentrated": "Concentrated",
            }
            if normalized in mapping:
                return mapping[normalized]

        if "blockComplexity" in config and config["blockComplexity"] is not None:
            complexity = max(0.0, min(1.0, float(config["blockComplexity"])))
            if complexity < 0.34:
                return "Scattered"
            if complexity > 0.66:
                return "Concentrated"
            return "Uniform"

        return "Uniform"

    def _log_layer(self, label: str, phase: str) -> None:
        self._current_layer = label
        print(f"[WorldGenerator] {phase}: {label}")

    def generate(self) -> dict:
        for label, method_name in LAYER_SEQUENCE:
            self._log_layer(label, "start")
            try:
                getattr(self, method_name)()
            except Exception as exc:
                raise RuntimeError(f"Layer failed: {label}") from exc
            self._log_layer(label, "complete")
        return self._build_output()

    def _calculate_house_count(self) -> None:
        self.building_counts["house"] = math.ceil(self.npc_count / 3.0)

    def _calculate_functional_building_counts(self) -> None:
        house_count = self.building_counts["house"]
        scale = max(1.0, house_count / 10.0)

        cafe = scale * 0.8
        shop = scale * 0.7
        park = scale * 0.6
        shrine = scale * 0.4
        school = scale * 0.4
        library = scale * 0.3
        gym = scale * 0.3
        arcade = scale * 0.3
        hospital = scale * 0.2
        office = scale * 0.6
        factory = scale * 0.4
        studio = scale * 0.3
        museum = scale * 0.22
        cinema = scale * 0.28

        if self.personality == "Extroverted":
            cafe *= 1.6
            shop *= 1.6
            arcade *= 1.5
            gym *= 1.3
            office *= 1.4
            studio *= 1.5
            cinema *= 1.6
        elif self.personality == "Introverted":
            park *= 1.5
            shrine *= 1.5
            library *= 1.5
            factory *= 1.5
            office *= 1.2
            museum *= 1.5

        self.building_counts["cafe"] = max(1, round(cafe))
        self.building_counts["shop"] = max(1, round(shop))
        self.building_counts["park"] = max(1, round(park))
        self.building_counts["shrine"] = max(1, round(shrine))
        self.building_counts["school"] = max(1, round(school))
        self.building_counts["library"] = max(1, round(library))
        self.building_counts["gym"] = max(1, round(gym))
        self.building_counts["arcade"] = max(1, round(arcade))
        self.building_counts["hospital"] = max(1, round(hospital))
        self.building_counts["office"] = max(1, round(office))
        self.building_counts["factory"] = max(1, round(factory))
        self.building_counts["studio"] = max(1, round(studio))
        self.building_counts["museum"] = max(1, round(museum))
        self.building_counts["cinema"] = max(1, round(cinema))

    def _calculate_map_size(self) -> None:
        total_buildings = sum(self.building_counts.values())
        estimated_area = total_buildings * 6400 * 2.5
        self.map_size = max(600, min(4000, round(math.sqrt(estimated_area))))

    def _add_street(self, tier: str, pts: list[dict], loc_id: int | None = None) -> dict:
        street = {"tier": tier, "pts": pts}
        if loc_id is not None:
            street["loc_id"] = loc_id
        self.streets.append(street)
        return street

    @staticmethod
    def _point_distance(left: dict, right: dict) -> float:
        return math.hypot(left["x"] - right["x"], left["y"] - right["y"])

    def _grid_pitch(self) -> tuple[int, int]:
        gap = self._house_gap()
        house_w, house_h = BUILDING_SIZES["house"]
        return house_w + gap, house_h + gap

    def _grid_footprint(self, width: int, height: int) -> tuple[int, int]:
        pitch_x, pitch_y = self._grid_pitch()
        cells_x = max(1, math.ceil(width / pitch_x))
        cells_y = max(1, math.ceil(height / pitch_y))
        return cells_x, cells_y

    def _snap_bbox_to_grid(self, bx: int, by: int, width: int, height: int) -> tuple[int, int, int, int]:
        pitch_x, pitch_y = self._grid_pitch()
        cells_x, cells_y = self._grid_footprint(width, height)

        cell_x = round((bx - self.pad) / pitch_x)
        cell_y = round((by - self.pad) / pitch_y)
        cell_x = max(0, cell_x)
        cell_y = max(0, cell_y)

        snapped_bx = self.pad + cell_x * pitch_x + max(0, (cells_x * pitch_x - width) // 2)
        snapped_by = self.pad + cell_y * pitch_y + max(0, (cells_y * pitch_y - height) // 2)
        snapped_bx = max(self.pad, min(self.map_size - self.pad - width, snapped_bx))
        snapped_by = max(self.pad, min(self.map_size - self.pad - height, snapped_by))
        return snapped_bx, snapped_by, cell_x, cell_y

    def _bbox_from_grid_cell(self, cell_x: int, cell_y: int, width: int, height: int) -> tuple[int, int]:
        pitch_x, pitch_y = self._grid_pitch()
        cells_x, cells_y = self._grid_footprint(width, height)
        bx = self.pad + cell_x * pitch_x + max(0, (cells_x * pitch_x - width) // 2)
        by = self.pad + cell_y * pitch_y + max(0, (cells_y * pitch_y - height) // 2)
        bx = max(self.pad, min(self.map_size - self.pad - width, bx))
        by = max(self.pad, min(self.map_size - self.pad - height, by))
        return bx, by

    def _iter_grid_candidates(
        self,
        raw_bx: int,
        raw_by: int,
        width: int,
        height: int,
        radius: int = 2,
    ) -> list[tuple[int, int, int, int]]:
        _, _, base_cell_x, base_cell_y = self._snap_bbox_to_grid(raw_bx, raw_by, width, height)
        seen = set()
        candidates = []
        for cell_dy in range(-radius, radius + 1):
            for cell_dx in range(-radius, radius + 1):
                cell_x = max(0, base_cell_x + cell_dx)
                cell_y = max(0, base_cell_y + cell_dy)
                key = (cell_x, cell_y)
                if key in seen:
                    continue
                seen.add(key)
                bx, by = self._bbox_from_grid_cell(cell_x, cell_y, width, height)
                candidates.append((bx, by, cell_x, cell_y))
        return candidates

    @staticmethod
    def _road_half_width(street: dict) -> float:
        return 9.0 if street["tier"] == "arterial" else 6.0

    def _iter_frontage_snap_candidates(
        self,
        anchor: dict,
        host_street: dict,
        size: tuple[int, int],
        road_network: list[dict],
        gap: int,
        tangent_span: int = 4,
        grid_radius: int = 3,
    ) -> list[dict]:
        width, height = size
        angle = road_angle_at_point(anchor["x"], anchor["y"], host_street["pts"])
        tangent_x = math.cos(angle)
        tangent_y = math.sin(angle)
        normal_x = -math.sin(angle)
        normal_y = math.cos(angle)
        road_half_width = self._road_half_width(host_street)
        base_support = self._projected_half_extent(width, height, normal_x, normal_y)
        pitch_x, pitch_y = self._grid_pitch()
        tangent_step = pitch_x if abs(tangent_x) >= abs(tangent_y) else pitch_y
        tangent_offsets = [0.0]
        for step in range(1, tangent_span + 1):
            tangent_offsets.extend([step * tangent_step, -step * tangent_step])

        seen_boxes = set()
        candidates = []

        for side in (-1, 1):
            side_nx = normal_x * side
            side_ny = normal_y * side
            side_tx = -side_ny
            side_ty = side_nx
            for tangent_offset in tangent_offsets:
                anchor_x = anchor["x"] + tangent_x * tangent_offset
                anchor_y = anchor["y"] + tangent_y * tangent_offset
                for setback_extra in (1.0, 2.5, 4.0):
                    desired = road_half_width + base_support + setback_extra
                    center_x = anchor_x + side_nx * desired
                    center_y = anchor_y + side_ny * desired
                    bx = int(round(center_x - width / 2))
                    by = int(round(center_y - height / 2))
                    bx = max(self.pad, min(self.map_size - self.pad - width, bx))
                    by = max(self.pad, min(self.map_size - self.pad - height, by))
                    box_key = (bx, by)
                    if box_key in seen_boxes:
                        continue
                    seen_boxes.add(box_key)

                    if check_building_overlap(bx, by, width, height, self.locations, gap=gap):
                        continue
                    if not self._bbox_respects_road_clearance(
                        bx,
                        by,
                        width,
                        height,
                        streets=road_network,
                        buffer=1.0,
                    ):
                        continue

                    center_x = bx + width / 2
                    center_y = by + height / 2
                    road_x, road_y, road_dist = closest_point_on_polyline(center_x, center_y, host_street["pts"])
                    outward_x = center_x - road_x
                    outward_y = center_y - road_y
                    outward_len = math.hypot(outward_x, outward_y) or 1.0
                    outward_x /= outward_len
                    outward_y /= outward_len
                    support = self._projected_half_extent(width, height, outward_x, outward_y)
                    road_gap = road_dist - (road_half_width + support)
                    if road_gap < -0.25:
                        continue
                    if road_gap > max(18.0, tangent_step * 0.35):
                        continue

                    setback = (center_x - anchor_x) * side_nx + (center_y - anchor_y) * side_ny
                    tangent_abs = abs((center_x - anchor_x) * side_tx + (center_y - anchor_y) * side_ty)
                    if setback < road_half_width + support:
                        continue

                    candidates.append(
                        {
                            "x": round(center_x),
                            "y": round(center_y),
                            "bx": bx,
                            "by": by,
                            "roadGap": road_gap,
                            "roadDist": road_dist,
                            "setback": setback,
                            "tangentAbs": tangent_abs,
                            "hostTier": host_street["tier"],
                        }
                    )

        return candidates

    def _grid_cells_free(self, cell_x: int, cell_y: int, cells_x: int, cells_y: int) -> bool:
        for dx in range(cells_x):
            for dy in range(cells_y):
                if (cell_x + dx, cell_y + dy) in self._occupied_grid:
                    return False
        return True

    def _occupy_grid(self, bx: int, by: int, width: int, height: int) -> None:
        pitch_x, pitch_y = self._grid_pitch()
        cells_x, cells_y = self._grid_footprint(width, height)
        cell_x = max(0, round((bx - self.pad - max(0, (cells_x * pitch_x - width) // 2)) / pitch_x))
        cell_y = max(0, round((by - self.pad - max(0, (cells_y * pitch_y - height) // 2)) / pitch_y))
        for dx in range(cells_x):
            for dy in range(cells_y):
                self._occupied_grid.add((cell_x + dx, cell_y + dy))

    @staticmethod
    def _street_length(street: dict) -> float:
        total = 0.0
        pts = street["pts"]
        for idx in range(len(pts) - 1):
            total += math.hypot(pts[idx + 1]["x"] - pts[idx]["x"], pts[idx + 1]["y"] - pts[idx]["y"])
        return total

    @staticmethod
    def _street_direction(street: dict) -> tuple[float, float]:
        start = street["pts"][0]
        end = street["pts"][-1]
        dx = end["x"] - start["x"]
        dy = end["y"] - start["y"]
        length = math.hypot(dx, dy) or 1.0
        return dx / length, dy / length

    @staticmethod
    def _segment_midpoint(street: dict) -> dict:
        start = street["pts"][0]
        end = street["pts"][-1]
        return {"x": (start["x"] + end["x"]) / 2.0, "y": (start["y"] + end["y"]) / 2.0}

    @staticmethod
    def _projected_half_extent(width: int, height: int, normal_x: float, normal_y: float) -> float:
        return abs(normal_x) * (width / 2.0) + abs(normal_y) * (height / 2.0)

    def _bbox_respects_road_clearance(
        self,
        bx: int,
        by: int,
        bw: int,
        bh: int,
        streets: list[dict] | None = None,
        buffer: float = 1.0,
    ) -> bool:
        if streets is None:
            streets = [street for street in self.streets if street["tier"] != "stub"]

        center_x = bx + bw / 2.0
        center_y = by + bh / 2.0
        for street in streets:
            road_x, road_y, dist = closest_point_on_polyline(center_x, center_y, street["pts"])
            normal_x = center_x - road_x
            normal_y = center_y - road_y
            normal_len = math.hypot(normal_x, normal_y) or 1.0
            normal_x /= normal_len
            normal_y /= normal_len
            support = self._projected_half_extent(bw, bh, normal_x, normal_y)
            road_half_width = 9 if street["tier"] == "arterial" else 6
            if dist < road_half_width + support + buffer:
                return False
        return True

    def _sub_road_is_too_close(
        self,
        candidate: dict,
        existing_locals: list[dict],
        branch_registry: dict[int, list[dict]],
        parent_index: int,
        min_branch_spacing: float,
        min_parallel_gap: float,
        endpoint_gap: float,
        arterial_roads: list[dict],
        parent_street: dict,
        min_arterial_gap: float,
    ) -> bool:
        for branch_point in branch_registry[parent_index]:
            if self._point_distance(branch_point, candidate["pts"][0]) < min_branch_spacing:
                return True

        cand_dir = self._street_direction(candidate)
        cand_mid = self._segment_midpoint(candidate)
        for road in existing_locals:
            if self._point_distance(candidate["pts"][0], road["pts"][0]) < endpoint_gap:
                return True
            if self._point_distance(candidate["pts"][-1], road["pts"][-1]) < endpoint_gap:
                return True

            road_dir = self._street_direction(road)
            alignment = abs(cand_dir[0] * road_dir[0] + cand_dir[1] * road_dir[1])
            if alignment < 0.85:
                continue

            _, _, mid_dist = closest_point_on_polyline(cand_mid["x"], cand_mid["y"], road["pts"])
            if mid_dist < min_parallel_gap:
                return True

        cand_dir = self._street_direction(candidate)
        cand_mid = self._segment_midpoint(candidate)
        for arterial in arterial_roads:
            if arterial is parent_street:
                continue
            arterial_dir = self._street_direction(arterial)
            alignment = abs(cand_dir[0] * arterial_dir[0] + cand_dir[1] * arterial_dir[1])
            if alignment < 0.8:
                continue
            _, _, mid_dist = closest_point_on_polyline(cand_mid["x"], cand_mid["y"], arterial["pts"])
            _, _, end_dist = closest_point_on_polyline(candidate["pts"][-1]["x"], candidate["pts"][-1]["y"], arterial["pts"])
            if min(mid_dist, end_dist) < min_arterial_gap:
                return True

        return False

    def _intersection_density(self, point: dict, host_street: dict, streets: list[dict]) -> int:
        count = 0
        for street in streets:
            if street is host_street or street["tier"] == "stub":
                continue
            _, _, dist = closest_point_on_polyline(point["x"], point["y"], street["pts"])
            if dist <= 22:
                count += 1
        return count

    def _nearby_frontage_count(self, x: float, y: float, streets: list[dict]) -> int:
        count = 0
        for street in streets:
            if street["tier"] == "stub":
                continue
            _, _, dist = closest_point_on_polyline(x, y, street["pts"])
            if dist <= 96:
                count += 1
        return count

    def _roads_near_point(self, point: dict, streets: list[dict], threshold: float = 14.0) -> list[dict]:
        touching = []
        for street in streets:
            if street["tier"] == "stub":
                continue
            _, _, dist = closest_point_on_polyline(point["x"], point["y"], street["pts"])
            if dist <= threshold:
                touching.append(street)
        return touching

    @staticmethod
    def _junction_rank(roads: list[dict]) -> int:
        arterial_count = sum(1 for road in roads if road["tier"] == "arterial")
        local_count = sum(1 for road in roads if road["tier"] == "local")
        if arterial_count >= 2:
            return 3
        if arterial_count >= 1 and local_count >= 1:
            return 2
        if local_count >= 2:
            return 1
        return 0

    def _collect_junctions(self, streets: list[dict]) -> list[dict]:
        clusters = []
        for street in streets:
            if street["tier"] == "stub" or len(street["pts"]) < 2:
                continue
            sample_points = [street["pts"][0], street["pts"][-1]]
            if len(street["pts"]) > 2:
                sample_points.extend(street["pts"][1:-1])
            for point in sample_points:
                touching = self._roads_near_point(point, streets)
                if len(touching) < 2:
                    continue

                merged = False
                for cluster in clusters:
                    if math.hypot(cluster["x"] - point["x"], cluster["y"] - point["y"]) > 18.0:
                        continue
                    sample_count = cluster["samples"] + 1
                    cluster["x"] = (cluster["x"] * cluster["samples"] + point["x"]) / sample_count
                    cluster["y"] = (cluster["y"] * cluster["samples"] + point["y"]) / sample_count
                    cluster["samples"] = sample_count
                    known = {id(road) for road in cluster["roads"]}
                    for road in touching:
                        if id(road) not in known:
                            cluster["roads"].append(road)
                    merged = True
                    break

                if not merged:
                    clusters.append(
                        {
                            "x": float(point["x"]),
                            "y": float(point["y"]),
                            "roads": list(touching),
                            "samples": 1,
                        }
                    )

        junctions = []
        for cluster in clusters:
            rank = self._junction_rank(cluster["roads"])
            if rank <= 0:
                continue

            point = {"x": int(round(cluster["x"])), "y": int(round(cluster["y"]))}
            arterial_count = sum(1 for road in cluster["roads"] if road["tier"] == "arterial")
            local_count = sum(1 for road in cluster["roads"] if road["tier"] == "local")
            frontage = self._nearby_frontage_count(point["x"], point["y"], streets)
            score = rank * 420.0 + arterial_count * 140.0 + local_count * 75.0 + frontage * 20.0
            junctions.append(
                {
                    "x": point["x"],
                    "y": point["y"],
                    "roads": cluster["roads"],
                    "rank": rank,
                    "arterialCount": arterial_count,
                    "localCount": local_count,
                    "frontage": frontage,
                    "score": score,
                }
            )

        junctions.sort(
            key=lambda item: (
                item["score"],
                item["rank"],
                item["arterialCount"],
                item["localCount"],
            ),
            reverse=True,
        )
        return junctions

    def _find_position_near_junction(
        self,
        junctions: list[dict],
        size: tuple[int, int],
        prefer_edge: bool = False,
        max_junctions: int = 3,
    ) -> dict | None:
        if not junctions:
            return None

        width, height = size
        road_network = [street for street in self.streets if street["tier"] != "stub"]
        best_candidate = None
        best_score = None
        seen_boxes = set()
        offsets = [
            (-1, -1),
            (-1, 1),
            (1, -1),
            (1, 1),
            (-1, 0),
            (1, 0),
            (0, -1),
            (0, 1),
        ]
        pitch_x, pitch_y = self._grid_pitch()

        for junction_index, junction in enumerate(junctions[:max_junctions]):
            for ring in range(1, 4):
                for side_x, side_y in offsets:
                    raw_bx = round(junction["x"] + side_x * pitch_x * ring - width / 2)
                    raw_by = round(junction["y"] + side_y * pitch_y * ring - height / 2)
                    bx, by, cell_x, cell_y = self._snap_bbox_to_grid(raw_bx, raw_by, width, height)
                    cells_x, cells_y = self._grid_footprint(width, height)
                    cell_key = (cell_x, cell_y, cells_x, cells_y)
                    if cell_key in seen_cells:
                        continue
                    seen_cells.add(cell_key)

                    if check_building_overlap(bx, by, width, height, self.locations, gap=8):
                        continue
                    if not self._grid_cells_free(cell_x, cell_y, cells_x, cells_y):
                        continue
                    if not self._bbox_respects_road_clearance(bx, by, width, height, streets=road_network, buffer=2.5):
                        continue

                    candidate = {
                        "x": round(bx + width / 2),
                        "y": round(by + height / 2),
                        "bx": bx,
                        "by": by,
                        "grid": {"x": cell_x, "y": cell_y, "w": cells_x, "h": cells_y},
                    }
                    road_bonus = 80.0 if any(road["tier"] == "arterial" for road in junction["roads"]) else 0.0
                    frontage_bonus = self._nearby_frontage_count(candidate["x"], candidate["y"], road_network) * 24.0
                    junction_dist = math.hypot(candidate["x"] - junction["x"], candidate["y"] - junction["y"])
                    center_dist = math.hypot(candidate["x"] - self.map_size / 2.0, candidate["y"] - self.map_size / 2.0)
                    score = junction["score"] * 3.0 + road_bonus + frontage_bonus
                    score -= junction_dist * 1.15
                    score -= junction_index * 90.0
                    if prefer_edge:
                        score += center_dist * 0.08
                    else:
                        score -= center_dist * 0.02

                    if best_score is None or score > best_score:
                        best_candidate = candidate
                        best_score = score

        return best_candidate

    @staticmethod
    def _point_side_of_street(point: dict, street: dict | None) -> int:
        if street is None:
            return 0
        start = street["pts"][0]
        end = street["pts"][-1]
        cross = (end["x"] - start["x"]) * (point["y"] - start["y"]) - (end["y"] - start["y"]) * (
            point["x"] - start["x"]
        )
        if abs(cross) < 1e-6:
            return 0
        return 1 if cross > 0 else -1

    def _primary_arterial(self, junctions: list[dict], arterial: list[dict]) -> dict | None:
        if junctions:
            candidate_roads = [road for road in junctions[0]["roads"] if road["tier"] == "arterial"]
            if candidate_roads:
                return max(candidate_roads, key=self._street_length)
        if arterial:
            return max(arterial, key=self._street_length)
        return None

    def _collect_functional_candidates(
        self,
        junctions: list[dict],
        size: tuple[int, int],
        primary_junction: dict | None,
        primary_street: dict | None,
        max_junctions: int = 4,
    ) -> list[dict]:
        if not junctions:
            return []

        width, height = size
        road_network = [street for street in self.streets if street["tier"] != "stub"]
        arterial_roads = [street for street in road_network if street["tier"] == "arterial"]
        pitch_x, pitch_y = self._grid_pitch()
        seen_boxes = set()
        candidates = []

        for junction_index, junction in enumerate(junctions[:max_junctions]):
            for ring in range(1, 5):
                anchor_step = max(pitch_x, pitch_y) * ring * 0.65
                for road in junction["roads"]:
                    angle = road_angle_at_point(junction["x"], junction["y"], road["pts"])
                    tangent_x = math.cos(angle)
                    tangent_y = math.sin(angle)
                    for direction in (-1, 1):
                        anchor = {
                            "x": junction["x"] + tangent_x * anchor_step * direction,
                            "y": junction["y"] + tangent_y * anchor_step * direction,
                        }
                        for candidate in self._iter_frontage_snap_candidates(
                            anchor,
                            road,
                            size,
                            road_network,
                            gap=8,
                            tangent_span=1,
                            grid_radius=1,
                        ):
                            box_key = (candidate["bx"], candidate["by"])
                            if box_key in seen_boxes:
                                continue
                            seen_boxes.add(box_key)

                            road_dist = min(
                                (
                                    closest_point_on_polyline(candidate["x"], candidate["y"], other["pts"])[2]
                                    for other in road_network
                                ),
                                default=float("inf"),
                            )
                            if road_dist > 56.0:
                                continue

                            candidate["junctionIndex"] = junction_index
                            candidate["junctionRank"] = junction["rank"]
                            candidate["junctionScore"] = junction["score"]
                            candidate["junctionDist"] = math.hypot(candidate["x"] - junction["x"], candidate["y"] - junction["y"])
                            candidate["centerDist"] = math.hypot(
                                candidate["x"] - self.map_size / 2.0,
                                candidate["y"] - self.map_size / 2.0,
                            )
                            candidate["ring"] = ring
                            candidate["roadDist"] = road_dist
                            candidate["side"] = self._point_side_of_street(
                                {"x": candidate["x"], "y": candidate["y"]},
                                primary_street,
                            )
                            candidate["frontage"] = self._nearby_frontage_count(candidate["x"], candidate["y"], road_network)
                            candidate["arterialDist"] = min(
                                (
                                    closest_point_on_polyline(candidate["x"], candidate["y"], other["pts"])[2]
                                    for other in arterial_roads
                                ),
                                default=float("inf"),
                            )
                            candidate["primaryDist"] = (
                                math.hypot(candidate["x"] - primary_junction["x"], candidate["y"] - primary_junction["y"])
                                if primary_junction is not None
                                else candidate["centerDist"]
                            )
                            candidates.append(candidate)

        return candidates

    def _score_functional_candidate(
        self,
        candidate: dict,
        building_type: str,
        side_loads: dict[int, int],
    ) -> float:
        score = candidate["junctionScore"] * 2.0
        score += candidate["frontage"] * 22.0
        score -= candidate.get("roadGap", 0.0) * 28.0
        if candidate["arterialDist"] <= 92:
            score += 120.0
        elif candidate["arterialDist"] <= 128:
            score += 55.0

        if candidate["side"] in (-1, 1):
            score -= side_loads.get(candidate["side"], 0) * 95.0

        if building_type == "cafe":
            score += candidate["junctionScore"] * 2.4
            score -= candidate["junctionIndex"] * 140.0
            score -= abs(candidate["ring"] - 1.5) * 75.0
            score -= candidate["primaryDist"] * 0.32
        elif building_type == "shop":
            score += candidate["junctionScore"] * 2.1
            score -= candidate["junctionIndex"] * 120.0
            score -= abs(candidate["ring"] - 2.0) * 55.0
            score -= candidate["primaryDist"] * 0.22
        elif building_type == "school":
            score += candidate["junctionScore"] * 1.3
            score -= candidate["junctionIndex"] * 55.0
            score -= abs(candidate["ring"] - 3.0) * 85.0
            score += min(candidate["primaryDist"], 220.0) * 0.18
            score -= candidate["frontage"] * 8.0
        elif building_type == "park":
            score += candidate["junctionScore"] * 0.9
            score -= abs(candidate["ring"] - 3.0) * 115.0
            score += min(candidate["primaryDist"], 220.0) * 0.22
            score -= candidate["frontage"] * 12.0
        elif building_type == "shrine":
            score += candidate["junctionIndex"] * 120.0
            score += candidate["centerDist"] * 0.14
            score += candidate["primaryDist"] * 0.20
            score -= candidate["frontage"] * 18.0
            score -= candidate["junctionScore"] * 0.3
        elif building_type in {"library", "museum", "hospital"}:
            score += candidate["junctionScore"] * 1.0
            score -= candidate["junctionIndex"] * 40.0
            score -= abs(candidate["ring"] - 2.8) * 70.0
            score += min(candidate["primaryDist"], 180.0) * 0.10
            score -= candidate["frontage"] * 6.0
        elif building_type in {"gym", "arcade", "cinema"}:
            score += candidate["junctionScore"] * 1.8
            score -= candidate["junctionIndex"] * 100.0
            score -= abs(candidate["ring"] - 1.8) * 52.0
            score -= candidate["primaryDist"] * 0.18

        return score

    def _select_functional_position(
        self,
        building_type: str,
        size: tuple[int, int],
        junctions: list[dict],
        primary_junction: dict | None,
        primary_street: dict | None,
        side_loads: dict[int, int],
        rejected_boxes: set[tuple[int, int]] = None,
    ) -> dict | None:
        if rejected_boxes is None:
            rejected_boxes = set()
        candidates = self._collect_functional_candidates(junctions, size, primary_junction, primary_street)
        best_candidate = None
        best_score = None
        for candidate in candidates:
            if (candidate["bx"], candidate["by"]) in rejected_boxes:
                continue
            score = self._score_functional_candidate(candidate, building_type, side_loads)
            if best_score is None or score > best_score:
                best_candidate = candidate
                best_score = score
        return best_candidate

    def _generate_main_roads(self) -> None:
        self.streets = []
        size = self.map_size
        pad = self.pad
        cx = round(size / 2)
        cy = round(size / 2)
        whole = int(math.floor(self.main_road_count))
        fraction = self.main_road_count - whole

        layouts = [
            [{"x": pad, "y": cy}, {"x": size - pad, "y": cy}],
            [{"x": cx, "y": pad}, {"x": cx, "y": size - pad}],
            [{"x": pad, "y": round(size * 0.28)}, {"x": size - pad, "y": round(size * 0.28)}],
            [{"x": round(size * 0.72), "y": pad}, {"x": round(size * 0.72), "y": size - pad}],
            [{"x": pad, "y": round(size * 0.72)}, {"x": size - pad, "y": round(size * 0.72)}],
        ]

        for pts in layouts[:whole]:
            self._add_street("arterial", pts)

        if fraction > 0.0 and self.streets:
            base = self.streets[0]["pts"]
            mid_x = round((base[0]["x"] + base[-1]["x"]) / 2)
            mid_y = round((base[0]["y"] + base[-1]["y"]) / 2)
            is_horizontal = abs(base[-1]["y"] - base[0]["y"]) <= abs(base[-1]["x"] - base[0]["x"])
            if is_horizontal:
                branch_end_y = pad if self.rng.random() < 0.5 else size - pad
                branch = [{"x": mid_x, "y": mid_y}, {"x": mid_x, "y": branch_end_y}]
            else:
                branch_end_x = pad if self.rng.random() < 0.5 else size - pad
                branch = [{"x": mid_x, "y": mid_y}, {"x": branch_end_x, "y": mid_y}]
            self._add_street("arterial", branch)

    def _generate_sub_roads(self) -> None:
        arterial_roads = [street for street in self.streets if street["tier"] == "arterial"]
        if not arterial_roads:
            return

        size = self.map_size
        pad = self.pad
        parent_candidates = [
            street for street in arterial_roads if self._street_length(street) >= (size - pad * 2) * 0.45
        ]
        if not parent_candidates:
            parent_candidates = arterial_roads

        branch_registry = {idx: [] for idx in range(len(parent_candidates))}
        existing_locals = []
        min_branch_spacing = max(42.0, size * 0.075)
        min_parallel_gap = max(22.0, size * 0.04)
        endpoint_gap = max(26.0, size * 0.045)
        min_arterial_gap = max(self._grid_pitch()[0] * 1.5, 46.0)

        for _ in range(self.sub_road_count):
            placed = False
            for attempt in range(140):
                parent_index = self.rng.randrange(len(parent_candidates))
                parent = parent_candidates[parent_index]
                start, end = parent["pts"][0], parent["pts"][-1]
                t = self.rng.uniform(0.2, 0.8)
                branch_x = round(start["x"] + (end["x"] - start["x"]) * t)
                branch_y = round(start["y"] + (end["y"] - start["y"]) * t)

                dx = end["x"] - start["x"]
                dy = end["y"] - start["y"]
                length = math.hypot(dx, dy) or 1.0
                normal_x = -dy / length
                normal_y = dx / length
                road_length = self.rng.uniform(size * 0.14, size * 0.28)
                direction = 1 if self.rng.random() < 0.5 else -1

                local_end_x = round(branch_x + normal_x * road_length * direction)
                local_end_y = round(branch_y + normal_y * road_length * direction)
                local_end_x = max(pad, min(size - pad, local_end_x))
                local_end_y = max(pad, min(size - pad, local_end_y))

                candidate = {
                    "tier": "local",
                    "pts": [{"x": branch_x, "y": branch_y}, {"x": local_end_x, "y": local_end_y}],
                }

                spacing = min_branch_spacing if attempt < 100 else min_branch_spacing * 0.7
                parallel_gap = min_parallel_gap if attempt < 100 else min_parallel_gap * 0.75
                if self._sub_road_is_too_close(
                    candidate,
                    existing_locals,
                    branch_registry,
                    parent_index,
                    spacing,
                    parallel_gap,
                    endpoint_gap,
                    arterial_roads,
                    parent,
                    min_arterial_gap,
                ):
                    continue

                self.streets.append(candidate)
                existing_locals.append(candidate)
                branch_registry[parent_index].append(candidate["pts"][0])
                placed = True
                break

            if not placed:
                print("[WorldGenerator] warning: unable to place all spaced sub roads")

    def _apply_road_transformations(self) -> None:
        if self.road_skew <= 0 and self.road_curve <= 0:
            return

        transformed = []
        for street in self.streets:
            points = [dict(point) for point in street["pts"]]

            if self.road_skew > 0 and len(points) == 2:
                start = points[0]
                end = points[-1]
                dx = end["x"] - start["x"]
                dy = end["y"] - start["y"]
                seg_len = math.hypot(dx, dy) or 1.0
                normal_x = -dy / seg_len
                normal_y = dx / seg_len
                offset = self.rng.uniform(-1.0, 1.0) * seg_len * 0.18 * self.road_skew
                midpoint = {
                    "x": round((start["x"] + end["x"]) / 2 + normal_x * offset),
                    "y": round((start["y"] + end["y"]) / 2 + normal_y * offset),
                }
                points = [start, midpoint, end]

            if self.road_curve > 0:
                curved = [points[0]]
                for index in range(len(points) - 1):
                    start = points[index]
                    end = points[index + 1]
                    dx = end["x"] - start["x"]
                    dy = end["y"] - start["y"]
                    seg_len = math.hypot(dx, dy) or 1.0
                    normal_x = -dy / seg_len
                    normal_y = dx / seg_len
                    bends = self.rng.randint(0, self.road_curve)
                    if bends > 0:
                        for bend_index in range(bends):
                            t = (bend_index + 1) / (bends + 1)
                            offset = self.rng.uniform(-1.0, 1.0) * seg_len * 0.08
                            curved.append(
                                {
                                    "x": round(start["x"] + dx * t + normal_x * offset),
                                    "y": round(start["y"] + dy * t + normal_y * offset),
                                }
                            )
                    curved.append(end)
                points = curved

            street["pts"] = [self._clamp_point(point) for point in points]
            transformed.append(street)

        self.streets = transformed

    def _clamp_point(self, point: dict) -> dict:
        return {
            "x": max(self.pad, min(self.map_size - self.pad, int(round(point["x"])))),
            "y": max(self.pad, min(self.map_size - self.pad, int(round(point["y"])))),
        }

    def _random_environment(self) -> dict:
        return {
            "quiet": round(self.rng.uniform(0.2, 0.9), 4),
            "crowded": round(self.rng.uniform(0.1, 0.8), 4),
        }

    def _capacity_for_type(self, building_type: str) -> int:
        if building_type == "house":
            return random_normal_int(self.rng, 1, 5, 3)
        return FIXED_CAPACITY[building_type]

    def _create_location(self, building_type: str, pos: dict) -> dict:
        width, height = BUILDING_SIZES[building_type]
        footprint_w, footprint_h = BUILDING_FOOTPRINTS[building_type]
        location = {
            "id": self._next_location_id,
            "type": building_type,
            "x": pos["x"],
            "y": pos["y"],
            "bx": pos["bx"],
            "by": pos["by"],
            "bw": width,
            "bh": height,
            "rotation": 0,
            "district": 0,
            "capacity": self._capacity_for_type(building_type),
            "occupants": 0,
            "occupant_ids": [],
            "environment": self._random_environment(),
            "footprint": {"w": footprint_w, "h": footprint_h},
        }
        self._next_location_id += 1
        self.locations.append(location)
        self._occupy_grid(location["bx"], location["by"], width, height)
        return location

    def _collect_intersections(self, streets: list[dict]) -> list[tuple[dict, dict]]:
        intersections = []
        for street in streets:
            if street["tier"] == "local" and len(street["pts"]) >= 2:
                intersections.append((street["pts"][0], street["pts"][1]))
        return intersections

    def _pick_anchor(
        self,
        streets: list[dict],
        prefer_edge: bool,
        prefer_intersection: bool,
    ) -> tuple[dict, dict, str, dict]:
        if prefer_intersection:
            intersections = self._collect_intersections(streets)
            if intersections and self.rng.random() < 0.7:
                point, neighbor = self.rng.choice(intersections)
                host_street = next(
                    (street for street in streets if street["tier"] == "local" and street["pts"][0] == point),
                    None,
                )
                return point, neighbor, "local", host_street

        street = self.rng.choice(streets)
        points = street["pts"]
        seg_index = self.rng.randint(0, len(points) - 2)
        start = points[seg_index]
        end = points[seg_index + 1]

        if prefer_edge:
            if self.rng.random() < 0.5:
                t = self.rng.uniform(0.0, 0.2)
            else:
                t = self.rng.uniform(0.8, 1.0)
        else:
            t = self.rng.uniform(0.1, 0.9)

        anchor = {
            "x": start["x"] + (end["x"] - start["x"]) * t,
            "y": start["y"] + (end["y"] - start["y"]) * t,
        }
        return anchor, end, street["tier"], street

    def _score_position_candidate(
        self,
        candidate: dict,
        tier: str,
        anchor: dict,
        host_street: dict,
        streets: list[dict],
        prefer_edge: bool,
    ) -> float:
        score = 0.0
        score += 140.0 if tier == "arterial" else 40.0
        score += self._intersection_density(anchor, host_street, streets) * 55.0
        score += self._nearby_frontage_count(candidate["x"], candidate["y"], streets) * 18.0

        center_x = self.map_size / 2.0
        center_y = self.map_size / 2.0
        center_dist = math.hypot(candidate["x"] - center_x, candidate["y"] - center_y)
        if prefer_edge:
            score += center_dist * 0.08
        else:
            score -= center_dist * 0.025

        return score

    def _find_position_near_road(
        self,
        streets: list[dict],
        size: tuple[int, int],
        prefer_edge: bool = False,
        prefer_intersection: bool = False,
        gap: int = 8,
    ) -> dict | None:
        if not streets:
            return None

        width, height = size
        road_network = [street for street in self.streets if street["tier"] != "stub"] or streets
        best_candidate = None
        best_score = None
        for _ in range(140):
            anchor, ref, tier, host_street = self._pick_anchor(streets, prefer_edge, prefer_intersection)
            for candidate in self._iter_frontage_snap_candidates(
                anchor,
                host_street,
                size,
                road_network,
                gap,
                tangent_span=4,
                grid_radius=3,
            ):
                score = self._score_position_candidate(candidate, tier, anchor, host_street, road_network, prefer_edge)
                score -= candidate["roadGap"] * 24.0
                score -= candidate["tangentAbs"] * 0.18
                if best_score is None or score > best_score:
                    best_candidate = candidate
                    best_score = score

        return best_candidate

    def _place_functional_buildings(self) -> None:
        arterial = [street for street in self.streets if street["tier"] == "arterial"]
        all_roads = [street for street in self.streets if street["tier"] in {"arterial", "local"}]
        junctions = self._collect_junctions(all_roads)
        primary_junction = junctions[0] if junctions else None
        primary_street = self._primary_arterial(junctions, arterial)
        side_loads = {-1: 0, 1: 0}

        for building_type in FUNCTIONAL_TYPES:
            target = self.building_counts.get(building_type, 0)
            size = BUILDING_SIZES[building_type]
            for _ in range(target):
                rejected_boxes = set()
                for attempt in range(5):
                    pos = self._select_functional_position(
                        building_type,
                        size,
                        junctions,
                        primary_junction,
                        primary_street,
                        side_loads,
                        rejected_boxes,
                    )

                    if pos is None:
                        pos = self._find_position_near_road(
                            arterial,
                            size,
                            prefer_edge=(building_type == "shrine"),
                            prefer_intersection=True,
                            gap=8,
                        )
                    if pos is None:
                        pos = self._find_position_near_road(
                            all_roads,
                            size,
                            prefer_edge=(building_type == "shrine"),
                            prefer_intersection=True,
                            gap=8,
                        )
                    if pos is None:
                        # Cannot place any more
                        break

                    too_close = False
                    for existing in self.locations:
                        if existing["type"] == building_type:
                            dist = math.hypot(existing["bx"] - pos["bx"], existing["by"] - pos["by"])
                            if dist < 200:
                                too_close = True
                                break

                    if not too_close or attempt == 4:
                        loc = self._create_location(building_type, pos)
                        side = self._point_side_of_street({"x": loc["x"], "y": loc["y"]}, primary_street)
                        if side in (-1, 1):
                            side_loads[side] = side_loads.get(side, 0) + 1
                        break
                    else:
                        rejected_boxes.add((pos["bx"], pos["by"]))

    def _house_gap(self) -> int:
        if self.building_density == "Scattered":
            return 16
        if self.building_density == "Concentrated":
            return 4
        return 8

    def _place_houses(self) -> None:
        size = BUILDING_SIZES["house"]
        gap = self._house_gap()
        local_roads = [street for street in self.streets if street["tier"] == "local"]
        arterial_roads = [street for street in self.streets if street["tier"] == "arterial"]
        
        for _ in range(self.building_counts["house"]):
            pos = self._find_position_near_road(local_roads, size, gap=gap)
            if pos is None:
                pos = self._find_position_near_road(arterial_roads, size, gap=gap)
            if pos is None:
                continue
            self._create_location("house", pos)

    def _translate_location(self, loc: dict, delta_x: float, delta_y: float) -> None:
        bx = int(round(loc["bx"] + delta_x))
        by = int(round(loc["by"] + delta_y))
        bx = max(self.pad, min(self.map_size - self.pad - loc["bw"], bx))
        by = max(self.pad, min(self.map_size - self.pad - loc["bh"], by))
        loc["bx"] = bx
        loc["by"] = by
        loc["x"] = bx + loc["bw"] // 2
        loc["y"] = by + loc["bh"] // 2

    @staticmethod
    def _bbox_edge_point(
        center_x: float,
        center_y: float,
        half_w: float,
        half_h: float,
        dir_x: float,
        dir_y: float,
    ) -> tuple[float, float, str]:
        candidates = []
        if abs(dir_x) > 1e-9:
            tx = (half_w / dir_x) if dir_x > 0 else (-half_w / dir_x)
            if tx > 0:
                candidates.append((tx, "right" if dir_x > 0 else "left"))
        if abs(dir_y) > 1e-9:
            ty = (half_h / dir_y) if dir_y > 0 else (-half_h / dir_y)
            if ty > 0:
                candidates.append((ty, "bottom" if dir_y > 0 else "top"))

        if not candidates:
            return center_x, center_y, "top"

        t, face = min(candidates, key=lambda item: item[0])
        edge_x = center_x + dir_x * t
        edge_y = center_y + dir_y * t
        edge_x = min(max(edge_x, center_x - half_w), center_x + half_w)
        edge_y = min(max(edge_y, center_y - half_h), center_y + half_h)
        return edge_x, edge_y, face

    def _frontage_for_road(self, loc: dict, street: dict, road_x: float, road_y: float, dist: float) -> dict:
        normal_x = loc["x"] - road_x
        normal_y = loc["y"] - road_y
        normal_len = math.hypot(normal_x, normal_y) or 1.0
        normal_x /= normal_len
        normal_y /= normal_len
        to_road_x = -normal_x
        to_road_y = -normal_y
        road_half_width = self._road_half_width(street)
        outward_x = -to_road_x
        outward_y = -to_road_y
        support = self._projected_half_extent(loc["bw"], loc["bh"], outward_x, outward_y)
        edge_gap = dist - (road_half_width + support)
        edge_x, edge_y, face = self._bbox_edge_point(
            loc["x"],
            loc["y"],
            loc["bw"] / 2.0,
            loc["bh"] / 2.0,
            to_road_x,
            to_road_y,
        )
        return {
            "tier": street["tier"],
            "dist": round(dist, 4),
            "nx": round(normal_x, 6),
            "ny": round(normal_y, 6),
            "angle": round(road_angle_at_point(road_x, road_y, street["pts"]), 6),
            "roadPt": {"x": int(round(road_x)), "y": int(round(road_y))},
            "edgePt": {"x": int(round(edge_x)), "y": int(round(edge_y))},
            "face": face,
            "edgeGap": round(edge_gap, 4),
            "radius": 6 if street["tier"] == "arterial" else 5,
        }

    def _collect_road_frontages(self, loc: dict) -> list[dict]:
        candidates_by_face = {}
        for street in self.streets:
            if street["tier"] == "stub":
                continue
            road_x, road_y, dist = closest_point_on_polyline(loc["x"], loc["y"], street["pts"])
            max_dist = 56.0 if loc["type"] != "house" else 44.0
            if dist > max_dist:
                continue
            frontage = self._frontage_for_road(loc, street, road_x, road_y, dist)
            max_edge_gap = 7.5 if loc["type"] != "house" else 5.0
            if frontage["edgeGap"] < -0.25 or frontage["edgeGap"] > max_edge_gap:
                continue

            face = frontage["face"]
            existing = candidates_by_face.get(face)
            if existing is None or (frontage["edgeGap"], frontage["dist"]) < (existing["edgeGap"], existing["dist"]):
                candidates_by_face[face] = frontage

        candidates = list(candidates_by_face.values())

        if loc["type"] == "house":
            candidates.sort(key=lambda item: (item["edgeGap"], item["dist"]))
        else:
            candidates.sort(
                key=lambda item: (
                    0 if item["tier"] == "local" else 1,
                    item["edgeGap"],
                    item["dist"],
                )
            )
        return candidates

    @staticmethod
    def _road_orientation(street: dict) -> str | None:
        if len(street["pts"]) != 2:
            return None
        start = street["pts"][0]
        end = street["pts"][-1]
        dx = abs(end["x"] - start["x"])
        dy = abs(end["y"] - start["y"])
        if dx >= dy * 2:
            return "horizontal"
        if dy >= dx * 2:
            return "vertical"
        return None

    @staticmethod
    def _segment_bounds(street: dict) -> tuple[int, int, int, int]:
        start = street["pts"][0]
        end = street["pts"][-1]
        return (
            min(start["x"], end["x"]),
            max(start["x"], end["x"]),
            min(start["y"], end["y"]),
            max(start["y"], end["y"]),
        )

    @staticmethod
    def _rects_overlap(left: tuple[float, float, float, float], right: tuple[float, float, float, float]) -> bool:
        return not (
            left[2] <= right[0]
            or right[2] <= left[0]
            or left[3] <= right[1]
            or right[3] <= left[1]
        )

    def _corridor_is_clear(
        self,
        rect: tuple[float, float, float, float],
        ignore_streets: tuple[dict, dict],
    ) -> bool:
        for loc in self.locations:
            building_rect = (
                loc["bx"] - 2,
                loc["by"] - 2,
                loc["bx"] + loc["bw"] + 2,
                loc["by"] + loc["bh"] + 2,
            )
            if self._rects_overlap(rect, building_rect):
                return False

        for street in self.streets:
            if street in ignore_streets or street["tier"] == "stub" or len(street["pts"]) != 2:
                continue
            x0, x1, y0, y1 = self._segment_bounds(street)
            road_pad = self._road_half_width(street) + 1
            road_rect = (x0 - road_pad, y0 - road_pad, x1 + road_pad, y1 + road_pad)
            if self._rects_overlap(rect, road_rect):
                return False
        return True

    def _corridor_has_flanking_buildings(
        self,
        orientation: str,
        axis_coord: float,
        span_start: float,
        span_end: float,
    ) -> bool:
        left_or_top = False
        right_or_bottom = False
        flank_gap = max(self._grid_pitch()[0], self._grid_pitch()[1]) * 1.25

        for loc in self.locations:
            bx0 = loc["bx"]
            bx1 = loc["bx"] + loc["bw"]
            by0 = loc["by"]
            by1 = loc["by"] + loc["bh"]

            if orientation == "vertical":
                if by1 <= span_start or by0 >= span_end:
                    continue
                if bx1 <= axis_coord and axis_coord - bx1 <= flank_gap:
                    left_or_top = True
                if bx0 >= axis_coord and bx0 - axis_coord <= flank_gap:
                    right_or_bottom = True
            else:
                if bx1 <= span_start or bx0 >= span_end:
                    continue
                if by1 <= axis_coord and axis_coord - by1 <= flank_gap:
                    left_or_top = True
                if by0 >= axis_coord and by0 - axis_coord <= flank_gap:
                    right_or_bottom = True

            if left_or_top and right_or_bottom:
                return True

        return False

    def _corridor_flank_gaps(
        self,
        orientation: str,
        axis_coord: float,
        span_start: float,
        span_end: float,
    ) -> tuple[float | None, float | None]:
        left_or_top_gap = None
        right_or_bottom_gap = None

        for loc in self.locations:
            bx0 = loc["bx"]
            bx1 = loc["bx"] + loc["bw"]
            by0 = loc["by"]
            by1 = loc["by"] + loc["bh"]

            if orientation == "vertical":
                if by1 <= span_start or by0 >= span_end:
                    continue
                if bx1 <= axis_coord:
                    gap = axis_coord - bx1
                    if left_or_top_gap is None or gap < left_or_top_gap:
                        left_or_top_gap = gap
                elif bx0 >= axis_coord:
                    gap = bx0 - axis_coord
                    if right_or_bottom_gap is None or gap < right_or_bottom_gap:
                        right_or_bottom_gap = gap
            else:
                if bx1 <= span_start or bx0 >= span_end:
                    continue
                if by1 <= axis_coord:
                    gap = axis_coord - by1
                    if left_or_top_gap is None or gap < left_or_top_gap:
                        left_or_top_gap = gap
                elif by0 >= axis_coord:
                    gap = by0 - axis_coord
                    if right_or_bottom_gap is None or gap < right_or_bottom_gap:
                        right_or_bottom_gap = gap

        return left_or_top_gap, right_or_bottom_gap

    def _candidate_connector(
        self,
        left: dict,
        right: dict,
        orientation: str,
    ) -> dict | None:
        pitch_x, pitch_y = self._grid_pitch()
        connector_half = 6.0
        flank_min_gap = connector_half + max(4.0, self._house_gap() * 0.75)
        if orientation == "horizontal":
            left_x0, left_x1, _, _ = self._segment_bounds(left)
            right_x0, right_x1, _, _ = self._segment_bounds(right)
            overlap_start = max(left_x0, right_x0) + pitch_x * 0.5
            overlap_end = min(left_x1, right_x1) - pitch_x * 0.5
            if overlap_end - overlap_start < pitch_x:
                return None

            y_top = min(left["pts"][0]["y"], right["pts"][0]["y"])
            y_bottom = max(left["pts"][0]["y"], right["pts"][0]["y"])
            gap = y_bottom - y_top
            if gap < pitch_y * 1.4 or gap > pitch_y * 4.5:
                return None

            best = None
            best_score = None
            x = overlap_start
            while x <= overlap_end:
                rect = (
                    x - 7,
                    y_top + self._road_half_width(left),
                    x + 7,
                    y_bottom - self._road_half_width(right),
                )
                if rect[3] - rect[1] >= 14 and self._corridor_is_clear(rect, (left, right)):
                    if self._corridor_has_flanking_buildings("vertical", x, rect[1], rect[3]):
                        left_gap, right_gap = self._corridor_flank_gaps("vertical", x, rect[1], rect[3])
                        if left_gap is None or right_gap is None:
                            x += pitch_x
                            continue
                        if left_gap < flank_min_gap or right_gap < flank_min_gap:
                            x += pitch_x
                            continue
                        center_bias = abs(((overlap_start + overlap_end) / 2.0) - x)
                        balance_penalty = abs(left_gap - right_gap) * 1.4
                        narrow_penalty = (1.0 / max(min(left_gap, right_gap), 1.0)) * 40.0
                        score = center_bias + balance_penalty + narrow_penalty + (rect[3] - rect[1]) * 0.12
                        if best_score is None or score < best_score:
                            best_score = score
                            best = {
                                "tier": "local",
                                "pts": [
                                    {"x": int(round(x)), "y": int(round(y_top))},
                                    {"x": int(round(x)), "y": int(round(y_bottom))},
                                ],
                                "connector": True,
                            }
                x += pitch_x
            return best

        left_y0, left_y1 = self._segment_bounds(left)[2], self._segment_bounds(left)[3]
        right_y0, right_y1 = self._segment_bounds(right)[2], self._segment_bounds(right)[3]
        overlap_start = max(left_y0, right_y0) + pitch_y * 0.5
        overlap_end = min(left_y1, right_y1) - pitch_y * 0.5
        if overlap_end - overlap_start < pitch_y:
            return None

        x_left = min(left["pts"][0]["x"], right["pts"][0]["x"])
        x_right = max(left["pts"][0]["x"], right["pts"][0]["x"])
        gap = x_right - x_left
        if gap < pitch_x * 1.4 or gap > pitch_x * 4.5:
            return None

        best = None
        best_score = None
        y = overlap_start
        while y <= overlap_end:
            rect = (
                x_left + self._road_half_width(left),
                y - 7,
                x_right - self._road_half_width(right),
                y + 7,
            )
            if rect[2] - rect[0] >= 14 and self._corridor_is_clear(rect, (left, right)):
                if self._corridor_has_flanking_buildings("horizontal", y, rect[0], rect[2]):
                    top_gap, bottom_gap = self._corridor_flank_gaps("horizontal", y, rect[0], rect[2])
                    if top_gap is None or bottom_gap is None:
                        y += pitch_y
                        continue
                    if top_gap < flank_min_gap or bottom_gap < flank_min_gap:
                        y += pitch_y
                        continue
                    center_bias = abs(((overlap_start + overlap_end) / 2.0) - y)
                    balance_penalty = abs(top_gap - bottom_gap) * 1.4
                    narrow_penalty = (1.0 / max(min(top_gap, bottom_gap), 1.0)) * 40.0
                    score = center_bias + balance_penalty + narrow_penalty + (rect[2] - rect[0]) * 0.12
                    if best_score is None or score < best_score:
                        best_score = score
                        best = {
                            "tier": "local",
                            "pts": [
                                {"x": int(round(x_left)), "y": int(round(y))},
                                {"x": int(round(x_right)), "y": int(round(y))},
                            ],
                            "connector": True,
                        }
            y += pitch_y
        return best

    def _connect_roads_between_buildings(self) -> None:
        existing = [street for street in self.streets if street["tier"] in {"arterial", "local"}]
        connectors = []
        seen_segments = set()

        for idx, left in enumerate(existing):
            left_orientation = self._road_orientation(left)
            if left_orientation is None:
                continue
            for right in existing[idx + 1 :]:
                if self._road_orientation(right) != left_orientation:
                    continue
                connector = self._candidate_connector(left, right, left_orientation)
                if connector is None:
                    continue
                key = (
                    connector["pts"][0]["x"],
                    connector["pts"][0]["y"],
                    connector["pts"][-1]["x"],
                    connector["pts"][-1]["y"],
                )
                if key in seen_segments:
                    continue
                seen_segments.add(key)
                connectors.append(connector)

        self.streets.extend(connectors)

    def _connect_single_building(self, loc: dict) -> None:
        frontages = self._collect_road_frontages(loc)
        if not frontages:
            return

        if loc["type"] == "house":
            loc["frontages"] = [frontages[0]]
            return

        selected = []
        used_faces = set()

        for frontage in frontages:
            if frontage["tier"] != "local":
                continue
            if frontage["face"] in used_faces:
                continue
            selected.append(frontage)
            used_faces.add(frontage["face"])
            if len(selected) >= 3:
                break

        if not selected:
            selected.append(frontages[0])
            used_faces.add(frontages[0]["face"])

        for frontage in frontages:
            if frontage["face"] in used_faces:
                continue
            selected.append(frontage)
            used_faces.add(frontage["face"])
            if len(selected) >= 3:
                break

        loc["frontages"] = selected

    def _connect_buildings_to_roads(self) -> None:
        self.streets = [street for street in self.streets if street["tier"] != "stub"]
        for loc in self.locations:
            loc.pop("frontages", None)
            loc.pop("roadClip", None)
            self._connect_single_building(loc)

    def _is_frontage_connected_to_road(self, frontage: dict, road: dict, threshold: float = 12.0) -> bool:
        road_pt = frontage["roadPt"]
        _, _, dist = closest_point_on_polyline(road_pt["x"], road_pt["y"], road["pts"])
        return dist <= threshold

    def _cleanup_unused_roads(self) -> None:
        frontages = [frontage for loc in self.locations for frontage in loc.get("frontages", [])]

        for street in list(self.streets):
            if street["tier"] != "local":
                continue
            
            start_touch = False
            end_touch = False
            for other in self.streets:
                if other is street or other["tier"] == "stub": continue
                if closest_point_on_polyline(street["pts"][0]["x"], street["pts"][0]["y"], other["pts"])[2] <= 15:
                    start_touch = True
                if closest_point_on_polyline(street["pts"][-1]["x"], street["pts"][-1]["y"], other["pts"])[2] <= 15:
                    end_touch = True
                    
            def connect_end(idx: int, sign: int, touched: bool) -> None:
                if touched: return
                p_end = street["pts"][idx]
                p_prev = street["pts"][idx - sign]
                dx = p_end["x"] - p_prev["x"]
                dy = p_end["y"] - p_prev["y"]
                length = math.hypot(dx, dy) or 1.0
                nx, ny = dx / length, dy / length
                
                for step in range(15, 81, 5):
                    cx = p_end["x"] + nx * step
                    cy = p_end["y"] + ny * step
                    for other in self.streets:
                        if other is street or other["tier"] == "stub": continue
                        rx, ry, d = closest_point_on_polyline(cx, cy, other["pts"])
                        if d < 12:
                            street["pts"][idx] = {"x": rx, "y": ry}
                            return
            
            if len(street["pts"]) >= 2:
                connect_end(0, 1, start_touch)
                connect_end(-1, -1, end_touch)
                
        cleaned = []
        for street in self.streets:
            if street["tier"] != "local":
                cleaned.append(street)
                continue
            if street.get("connector"):
                cleaned.append(street)
                continue

            has_building = any(self._is_frontage_connected_to_road(frontage, street) for frontage in frontages)
            if has_building:
                cleaned.append(street)
            else:
                touches = 0
                for other in self.streets:
                    if other is street or other["tier"] == "stub": continue
                    d1 = closest_point_on_polyline(street["pts"][0]["x"], street["pts"][0]["y"], other["pts"])[2]
                    d2 = closest_point_on_polyline(street["pts"][-1]["x"], street["pts"][-1]["y"], other["pts"])[2]
                    if d1 <= 15 or d2 <= 15:
                        touches += 1
                
                if touches <= 1:
                    if self.rng.random() >= 0.90:
                        cleaned.append(street)
                else:
                    cleaned.append(street)
                    
        self.streets = cleaned

    def _assign_shapes(self) -> None:
        shapes = [0, 1, 2, 3]
        for loc in self.locations:
            if loc["type"] == "house": continue
            loc["shape"] = self.rng.choice(shapes)
            
        houses = [loc for loc in self.locations if loc["type"] == "house"]
        clusters = []
        for h in houses:
            placed = False
            for c in clusters:
                if any(math.hypot(h["bx"] - ch["bx"], h["by"] - ch["by"]) < 65 for ch in c["houses"]):
                    c["houses"].append(h)
                    placed = True
                    break
            if not placed:
                clusters.append({"shape": self.rng.choice(shapes), "houses": [h]})
        
        for c in clusters:
            for h in c["houses"]:
                h["shape"] = c["shape"]

    def _roads_touch(self, left: dict, right: dict, threshold: float = 15.0) -> bool:
        for point in (left["pts"][0], left["pts"][-1]):
            _, _, dist = closest_point_on_polyline(point["x"], point["y"], right["pts"])
            if dist <= threshold:
                return True
        for point in (right["pts"][0], right["pts"][-1]):
            _, _, dist = closest_point_on_polyline(point["x"], point["y"], left["pts"])
            if dist <= threshold:
                return True
        return False

    def _verify_connectivity(self) -> None:
        arterial = [street for street in self.streets if street["tier"] == "arterial"]
        locals_only = [street for street in self.streets if street["tier"] == "local"]

        connected = set()
        for idx, road in enumerate(locals_only):
            if any(self._roads_touch(road, main) for main in arterial):
                connected.add(idx)

        changed = True
        while changed:
            changed = False
            for idx, road in enumerate(locals_only):
                if idx in connected:
                    continue
                if any(self._roads_touch(road, locals_only[other]) for other in connected):
                    connected.add(idx)
                    changed = True

        kept_locals = [locals_only[idx] for idx in sorted(connected)]
        self.streets = arterial + kept_locals

    def _place_missing_building(self, building_type: str) -> bool:
        size = BUILDING_SIZES[building_type]
        gap = self._house_gap() if building_type == "house" else 8
        roads = [street for street in self.streets if street["tier"] in {"arterial", "local"}]
        prefer_intersection = building_type != "house"
        prefer_edge = building_type == "shrine"

        for _ in range(100):
            pos = self._find_position_near_road(
                roads,
                size,
                prefer_edge=prefer_edge,
                prefer_intersection=prefer_intersection,
                gap=gap,
            )
            if pos is None:
                continue
            loc = self._create_location(building_type, pos)
            self._connect_single_building(loc)
            return True

        print(f"[WorldGenerator] warning: unable to place missing {building_type}")
        return False

    def _verify_building_counts(self) -> None:
        placed: dict[str, int] = {}
        for loc in self.locations:
            placed[loc["type"]] = placed.get(loc["type"], 0) + 1

        for building_type, target in self.building_counts.items():
            current = placed.get(building_type, 0)
            for _ in range(max(0, target - current)):
                if not self._place_missing_building(building_type):
                    break

        self._ensure_house_capacity()

    def _ensure_house_capacity(self) -> None:
        houses = [loc for loc in self.locations if loc["type"] == "house"]
        if not houses:
            return

        deficit = self.npc_count - sum(house["capacity"] for house in houses)
        if deficit <= 0:
            return

        ordered = sorted(houses, key=lambda loc: (loc["capacity"], loc["id"]))
        while deficit > 0:
            changed = False
            for house in ordered:
                if house["capacity"] < 5:
                    house["capacity"] += 1
                    deficit -= 1
                    changed = True
                    if deficit <= 0:
                        break
            if not changed:
                print("[WorldGenerator] warning: total house capacity still below npc count")
                break

    @staticmethod
    def _district_type_for_building(building_type: str) -> str:
        if building_type in {"park"}:
            return "nature"
        if building_type in {"cafe", "shop", "shrine", "gym", "arcade", "museum", "cinema"}:
            return "entertainment"
        return "residential"

    def _build_district_layout(self) -> None:
        self.districts = []
        self.city_blocks = []
        if not self.locations:
            return

        district_types = ["residential", "entertainment", "nature"]
        grouped = {district_type: [] for district_type in district_types}
        for loc in self.locations:
            grouped[self._district_type_for_building(loc["type"])].append(loc)

        all_left = min(loc["bx"] for loc in self.locations)
        all_right = max(loc["bx"] + loc["bw"] for loc in self.locations)
        all_top = min(loc["by"] for loc in self.locations)
        all_bottom = max(loc["by"] + loc["bh"] for loc in self.locations)

        pad_x = max(28, self._grid_pitch()[0])
        pad_y = max(24, self._grid_pitch()[1])
        raw_specs = []
        for district_type in district_types:
            members = grouped[district_type]
            if members:
                left = min(loc["bx"] for loc in members) - pad_x
                right = max(loc["bx"] + loc["bw"] for loc in members) + pad_x
                cx = sum(loc["x"] for loc in members) / len(members)
            else:
                left = all_left - pad_x
                right = all_right + pad_x
                cx = (all_left + all_right) / 2.0
            raw_specs.append(
                {
                    "type": district_type,
                    "left": max(self.pad, left),
                    "right": min(self.map_size - self.pad, right),
                    "center": cx,
                }
            )

        ordered = sorted(raw_specs, key=lambda item: item["center"])
        top = max(self.pad, all_top - pad_y)
        bottom = min(self.map_size - self.pad, all_bottom + pad_y)
        y_levels = [
            int(round(top)),
            int(round(top + (bottom - top) * 0.32)),
            int(round(top + (bottom - top) * 0.68)),
            int(round(bottom)),
        ]

        def members_in_band(members: list[dict], y0: int, y1: int) -> list[dict]:
            return [
                loc
                for loc in members
                if not (loc["by"] + loc["bh"] <= y0 or loc["by"] >= y1)
            ]

        boundaries = []
        left_edge = min(item["left"] for item in ordered)
        right_edge = max(item["right"] for item in ordered)
        boundaries.append([left_edge for _ in y_levels])
        for idx in range(len(ordered) - 1):
            left_item = ordered[idx]
            right_item = ordered[idx + 1]
            if left_item["right"] < right_item["left"]:
                base_boundary = (left_item["right"] + right_item["left"]) / 2.0
            else:
                base_boundary = (left_item["center"] + right_item["center"]) / 2.0

            polyline = []
            left_members = grouped[left_item["type"]]
            right_members = grouped[right_item["type"]]
            for band_idx in range(len(y_levels)):
                y = y_levels[band_idx]
                if band_idx == len(y_levels) - 1:
                    band_y0 = y_levels[band_idx - 1]
                    band_y1 = y_levels[band_idx]
                else:
                    band_y0 = y_levels[band_idx]
                    band_y1 = y_levels[min(len(y_levels) - 1, band_idx + 1)]
                left_band = members_in_band(left_members, min(band_y0, band_y1), max(band_y0, band_y1) + 1)
                right_band = members_in_band(right_members, min(band_y0, band_y1), max(band_y0, band_y1) + 1)

                x = base_boundary
                if left_band and right_band:
                    left_pref = max(loc["bx"] + loc["bw"] for loc in left_band) + pad_x * 0.6
                    right_pref = min(loc["bx"] for loc in right_band) - pad_x * 0.6
                    if left_pref < right_pref:
                        x = (left_pref + right_pref) / 2.0

                x = max(left_edge + pad_x * 0.8, min(right_edge - pad_x * 0.8, x))
                x = max(base_boundary - pad_x * 1.2, min(base_boundary + pad_x * 1.2, x))
                polyline.append(int(round(x)))

            for point_idx in range(1, len(polyline) - 1):
                polyline[point_idx] = int(round((polyline[point_idx - 1] + polyline[point_idx] + polyline[point_idx + 1]) / 3.0))
            boundaries.append(polyline)
        boundaries.append([right_edge for _ in y_levels])

        district_index = {}
        for idx, item in enumerate(ordered):
            left_boundary = boundaries[idx]
            right_boundary = boundaries[idx + 1]
            points = []
            for point_idx, y in enumerate(y_levels):
                points.append({"x": int(round(left_boundary[point_idx])), "y": int(round(y))})
            for point_idx in range(len(y_levels) - 1, -1, -1):
                points.append({"x": int(round(right_boundary[point_idx])), "y": int(round(y_levels[point_idx]))})

            xs = [point["x"] for point in points]
            ys = [point["y"] for point in points]
            x0 = min(xs)
            x1 = max(xs)
            y0 = min(ys)
            y1 = max(ys)

            district_index[item["type"]] = idx
            self.city_blocks.append(
                {
                    "x": x0,
                    "y": y0,
                    "w": int(round(x1 - x0)),
                    "h": int(round(y1 - y0)),
                    "points": points,
                    "districtType": item["type"],
                }
            )
            self.districts.append(
                {
                    "id": idx,
                    "type": item["type"],
                    "x": int(round(sum(xs) / len(xs))),
                    "y": int(round(sum(ys) / len(ys))),
                    "radius": int(round(min(x1 - x0, y1 - y0) / 2.0)),
                }
            )

        for loc in self.locations:
            loc["district"] = district_index[self._district_type_for_building(loc["type"])]

    def _build_location_graph(self) -> None:
        self.roads = []
        if len(self.locations) < 2:
            return

        seen = set()

        def add_edge(left_idx: int, right_idx: int) -> None:
            left_id = self.locations[left_idx]["id"]
            right_id = self.locations[right_idx]["id"]
            key = (min(left_id, right_id), max(left_id, right_id))
            if key in seen:
                return
            seen.add(key)
            self.roads.append({"from": key[0], "to": key[1], "curvature": 0})

        all_edges = []
        for left_idx in range(len(self.locations)):
            for right_idx in range(left_idx + 1, len(self.locations)):
                left = self.locations[left_idx]
                right = self.locations[right_idx]
                dist = math.hypot(left["x"] - right["x"], left["y"] - right["y"])
                if dist <= 200:
                    add_edge(left_idx, right_idx)
                all_edges.append((dist, left_idx, right_idx))

        parents = list(range(len(self.locations)))

        def find(node: int) -> int:
            while parents[node] != node:
                parents[node] = parents[parents[node]]
                node = parents[node]
            return node

        for _, left_idx, right_idx in sorted(all_edges, key=lambda item: item[0]):
            root_left = find(left_idx)
            root_right = find(right_idx)
            if root_left == root_right:
                continue
            parents[root_left] = root_right
            add_edge(left_idx, right_idx)

    def _assign_npc_spawns(self) -> None:
        self.npc_spawns = []
        houses = [loc for loc in self.locations if loc["type"] == "house"]
        for loc in self.locations:
            loc["occupants"] = 0
            loc["occupant_ids"] = []

        if not houses:
            return

        self._ensure_house_capacity()
        self.rng.shuffle(houses)
        remaining = self.npc_count
        planned = {}

        for house in houses:
            if remaining <= 0:
                planned[house["id"]] = 0
                continue
            peak = max(1, round(house["capacity"] * 0.6))
            target = random_normal_int(self.rng, 1, house["capacity"], peak)
            assigned = min(target, remaining)
            planned[house["id"]] = assigned
            remaining -= assigned

        while remaining > 0:
            progress = False
            for house in houses:
                current = planned.get(house["id"], 0)
                if current >= house["capacity"]:
                    continue
                planned[house["id"]] = current + 1
                remaining -= 1
                progress = True
                if remaining <= 0:
                    break
            if not progress:
                print("[WorldGenerator] warning: unable to assign all NPCs to houses")
                break

        npc_id = 0
        for house in houses:
            count = planned.get(house["id"], 0)
            house["occupants"] = count
            house["occupant_ids"] = list(range(npc_id, npc_id + count))
            for _ in range(count):
                self.npc_spawns.append({"npc": npc_id, "location": house["id"]})
                npc_id += 1

    def _build_output(self) -> dict:
        return {
            "districts": self.districts,
            "locations": self.locations,
            "roads": self.roads,
            "streets": self.streets,
            "cityBlocks": self.city_blocks,
            "npcSpawns": self.npc_spawns,
            "roadSkew": self.road_skew,
            "roadCurve": self.road_curve,
            "seed": self.seed,
            "mapSize": self.map_size,
        }


def generate_world(config: dict | None) -> dict:
    """Entry point used by the plugin state engine."""

    generator = WorldGenerator(config)
    return generator.generate()
