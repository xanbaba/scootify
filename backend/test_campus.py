from unittest import TestCase

from .campus import load_graph


class CampusGraphTests(TestCase):
    def setUp(self) -> None:
        self.graph = load_graph()
        self.segments = {segment.id: segment for segment in self.graph.segments}

    def assert_connected(self, segment_ids: list[str], start: str, end: str, mode: str) -> None:
        node = start
        for segment_id in segment_ids:
            segment = self.segments[segment_id]
            self.assertIn(mode, segment.modes)
            if node == segment.from_node:
                node = segment.to_node
            else:
                self.assertFalse(segment.one_way, segment.id)
                self.assertEqual(node, segment.to_node)
                node = segment.from_node
        self.assertEqual(node, end)

    def test_graph_geometry_matches_its_junctions(self) -> None:
        nodes = {node.id: (node.latitude, node.longitude) for node in self.graph.nodes}
        self.assertEqual(len(nodes), len(self.graph.nodes))
        self.assertEqual(len(self.segments), len(self.graph.segments))
        for segment in self.graph.segments:
            self.assertEqual(segment.geometry[0], nodes[segment.from_node])
            self.assertEqual(segment.geometry[-1], nodes[segment.to_node])
        for connection in self.graph.rack_connections:
            self.assertIn(connection.node_id, nodes)

    def test_bike_detour_survives_the_primary_closure(self) -> None:
        demo = self.graph.demo
        self.assertIn(demo.closure_segment, demo.primary_segments)
        self.assertNotIn(demo.closure_segment, demo.detour_segments)
        self.assert_connected(demo.primary_segments, demo.origin_node, demo.parking_node, "bike")
        self.assert_connected(demo.detour_segments, demo.origin_node, demo.parking_node, "bike")
        primary_distance = sum(self.segments[id].length_m for id in demo.primary_segments)
        detour_distance = sum(self.segments[id].length_m for id in demo.detour_segments)
        self.assertLess(primary_distance, detour_distance)

    def test_parking_connects_to_the_library_door_on_foot(self) -> None:
        demo = self.graph.demo
        self.assert_connected(demo.walk_segments, demo.parking_node, demo.entrance_node, "walk")
        self.assertNotIn("bike", self.segments[demo.walk_segments[-1]].modes)
