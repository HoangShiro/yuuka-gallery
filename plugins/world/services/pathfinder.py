from collections import deque


class Pathfinder:
    """Tìm đường ngắn nhất trên road graph dùng BFS."""

    def __init__(self, locations: list, roads: list):
        """Xây dựng adjacency graph từ danh sách locations và roads.

        Args:
            locations: list of dicts { id, type, x, y, district, capacity, occupants }
            roads: list of dicts { from, to, curvature }
        """
        # Tập hợp tất cả location id hợp lệ
        self._location_ids = {loc["id"] for loc in locations}

        # Adjacency list: id -> set of neighbor ids
        self._graph: dict[int, set] = {loc["id"]: set() for loc in locations}

        # Roads là undirected — thêm cả hai chiều
        for road in roads:
            src = road["from"]
            dst = road["to"]
            if src in self._graph and dst in self._graph:
                self._graph[src].add(dst)
                self._graph[dst].add(src)

    def find_path(self, from_id: int, to_id: int) -> list[int] | None:
        """Tìm đường ngắn nhất (ít hop nhất) từ from_id đến to_id bằng BFS.

        Args:
            from_id: id của location xuất phát
            to_id: id của location đích

        Returns:
            Danh sách location id theo thứ tự từ from_id đến to_id (inclusive),
            hoặc None nếu không có path.
        """
        # Trường hợp đặc biệt: path đến chính mình
        if from_id == to_id:
            return [from_id]

        # Kiểm tra node tồn tại trong graph
        if from_id not in self._graph or to_id not in self._graph:
            return None

        # BFS: queue chứa (node hiện tại, path đến node đó)
        queue = deque([(from_id, [from_id])])
        visited = {from_id}

        while queue:
            current, path = queue.popleft()

            for neighbor in self._graph[current]:
                if neighbor == to_id:
                    return path + [neighbor]

                if neighbor not in visited:
                    visited.add(neighbor)
                    queue.append((neighbor, path + [neighbor]))

        # Không tìm thấy path
        return None
