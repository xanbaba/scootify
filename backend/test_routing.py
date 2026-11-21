from unittest import TestCase
from uuid import UUID

from .campus import CampusNode, Destination, PathSegment, RackConnection, load_graph
from .routing import MapPoint, RouteRequest, RouteUnavailable, plan_route


class TripRoutingTests(TestCase):
    def setUp(self) -> None:
        self.graph = load_graph()
        self.library = RouteRequest(destination_id="tampa-library")

    def test_preset_trip_joins_both_legs_at_the_library_rack(self) -> None:
        trip = plan_route(self.graph, self.library)
        demo = self.graph.demo
        self.assertEqual(trip.ride.segment_ids, demo.primary_segments)
        self.assertEqual(trip.walk.segment_ids, demo.walk_segments)
        self.assertEqual(trip.ride.geometry[-1], trip.walk.geometry[0])
        self.assertGreater(trip.ride.duration_seconds, 0)
        self.assertGreater(trip.walk.duration_seconds, 0)

    def test_router_finds_another_approach_when_primary_segment_is_removed(self) -> None:
        closure = self.graph.demo.closure_segment
        self.graph.segments = [segment for segment in self.graph.segments if segment.id != closure]

        trip = plan_route(self.graph, self.library)

        self.assertNotIn(closure, trip.ride.segment_ids)
        self.assertEqual(trip.ride.geometry[-1], trip.walk.geometry[0])

    def test_start_far_from_the_graph_is_rejected(self) -> None:
        self.library.start = MapPoint(latitude=28.07, longitude=-82.42)
        with self.assertRaisesRegex(RouteUnavailable, "within 35 m"):
            plan_route(self.graph, self.library)

    def test_best_rack_uses_total_time_and_requires_both_legs(self) -> None:
        coordinates = {
            "s": (0.0, 0.0), "a": (0.001, 0.001), "b": (0.0, 0.002),
            "c": (0.001, 0.0), "d": (0.001, 0.002),
        }
        self.graph.nodes = [
            CampusNode(id=name, latitude=lat, longitude=lng)
            for name, (lat, lng) in coordinates.items()
        ]
        self.graph.demo.origin_node = "s"
        self.graph.destinations = [Destination(id="destination", name="Building", entrance_node="d")]
        self.graph.rack_connections = [
            RackConnection(rack_id=UUID(int=index), node_id=node, name=node)
            for index, node in enumerate("abc", start=1)
        ]

        def edge(start, end, mode, length, *, one_way=False):
            return PathSegment(
                id=start + end, name=start + end, from_node=start, to_node=end,
                geometry=[coordinates[start], coordinates[end]], length_m=length,
                modes=[mode], one_way=one_way,
            )

        self.graph.segments = [
            edge("s", "a", "bike", 300),
            edge("s", "b", "bike", 36, one_way=True),
            edge("s", "c", "bike", 1),
            edge("a", "d", "walk", 10),
            edge("b", "d", "walk", 60, one_way=True),
            edge("d", "c", "walk", 1, one_way=True),
        ]

        trip = plan_route(self.graph, RouteRequest(destination_id="destination"))
        self.assertEqual(trip.rack_id, UUID(int=2))
        self.assertEqual(trip.walk.geometry, [coordinates["b"], coordinates["d"]])

        midpoint = MapPoint(latitude=0, longitude=0.0015)
        trip = plan_route(self.graph, RouteRequest(destination_id="destination", start=midpoint))
        self.assertEqual(trip.rack_id, UUID(int=2))
        self.assertEqual(trip.ride.geometry[1:], [coordinates["b"]])
        self.assertAlmostEqual(trip.ride.geometry[0][0], midpoint.latitude)
        self.assertAlmostEqual(trip.ride.geometry[0][1], midpoint.longitude)
        self.assertEqual(trip.ride.distance_m, 9)

        self.graph.rack_connections = self.graph.rack_connections[:1]
        with self.assertRaisesRegex(RouteUnavailable, "No bike-and-walk trip"):
            plan_route(self.graph, RouteRequest(destination_id="destination", start=midpoint))

    def test_no_route_when_all_racks_lose_the_walk_connection(self) -> None:
        self.graph.segments = [
            segment for segment in self.graph.segments
            if "walk" not in segment.modes or self.graph.demo.entrance_node not in (segment.from_node, segment.to_node)
        ]
        with self.assertRaisesRegex(RouteUnavailable, "No bike-and-walk trip"):
            plan_route(self.graph, self.library)
