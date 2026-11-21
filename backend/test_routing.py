from unittest import TestCase
from uuid import UUID

from .campus import CampusNode, Destination, PathSegment, RackConnection, load_graph
from .routing import MapPoint, RouteRequest, RouteUnavailable, plan_route


class TripRoutingTests(TestCase):
    def setUp(self) -> None:
        self.graph = load_graph()
        self.library = RouteRequest(destination_id="tampa-library")

    def test_preset_trip_uses_the_primary_approach_and_library_rack(self) -> None:
        trip = plan_route(self.graph, self.library)
        demo = self.graph.demo
        approach_segments = trip.approach.segment_ids if trip.approach else []
        self.assertEqual(approach_segments + trip.ride.segment_ids, demo.primary_segments)
        self.assertEqual(trip.walk.segment_ids, demo.walk_segments)
        self.assertEqual(trip.ride.geometry[-1], trip.walk.geometry[0])
        self.assertGreater(trip.ride.duration_seconds, 0)
        self.assertGreater(trip.walk.duration_seconds, 0)

    def test_router_finds_another_approach_when_primary_segment_is_removed(self) -> None:
        closure = self.graph.demo.closure_segment
        self.graph.segments = [segment for segment in self.graph.segments if segment.id != closure]

        trip = plan_route(self.graph, self.library)

        self.assertNotIn(closure, trip.ride.segment_ids)
        if trip.approach:
            self.assertNotIn(closure, trip.approach.segment_ids)
        self.assertEqual(trip.ride.geometry[-1], trip.walk.geometry[0])

    def test_start_outside_coverage_is_rejected(self) -> None:
        self.graph.bounds = ((28.0547, -82.4260), (28.0692, -82.4019))
        self.library.start = MapPoint(latitude=28.07, longitude=-82.42)
        with self.assertRaisesRegex(RouteUnavailable, "outside the USF Tampa routing area"):
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
        self.assertIsNone(trip.approach)
        self.assertEqual(trip.ride.geometry[1:], [coordinates["b"]])
        self.assertAlmostEqual(trip.ride.geometry[0][0], midpoint.latitude)
        self.assertAlmostEqual(trip.ride.geometry[0][1], midpoint.longitude)
        self.assertEqual(trip.ride.distance_m, 9)

        self.graph.rack_connections = self.graph.rack_connections[:1]
        with self.assertRaisesRegex(RouteUnavailable, "No bike-and-walk trip"):
            plan_route(self.graph, RouteRequest(destination_id="destination", start=midpoint))

    def test_walk_first_beats_riding_the_detour_and_uses_only_open_paths(self) -> None:
        coordinates = {"s": (0, 0), "j": (0, 0.0001), "rack": (0, 0.001), "d": (0, 0.0011)}
        self.graph.nodes = [
            CampusNode(id=node, latitude=lat, longitude=lng)
            for node, (lat, lng) in coordinates.items()
        ]
        self.graph.demo.origin_node = "s"
        self.graph.destinations = [Destination(id="destination", name="Building", entrance_node="d")]
        self.graph.rack_connections = [RackConnection(rack_id=UUID(int=1), node_id="rack", name="Rack")]

        self.graph.segments = [
            PathSegment(id="stairs", name="Steps", from_node="s", to_node="j", modes=["walk"],
                        geometry=[coordinates["s"], coordinates["j"]], length_m=14),
            PathSegment(id="ride", name="Path", from_node="j", to_node="rack", modes=["bike"],
                        geometry=[coordinates["j"], coordinates["rack"]], length_m=100),
            PathSegment(id="detour", name="Detour", from_node="s", to_node="rack", modes=["bike"],
                        geometry=[coordinates["s"], (0.001, 0.0005), coordinates["rack"]], length_m=250),
            PathSegment(id="entrance", name="Walkway", from_node="rack", to_node="d", modes=["walk"],
                        geometry=[coordinates["rack"], coordinates["d"]], length_m=14),
        ]

        request = RouteRequest(destination_id="destination")
        trip = plan_route(self.graph, request)
        self.assertIsNotNone(trip.approach)
        self.assertEqual(trip.approach.segment_ids, ["stairs"])
        self.assertEqual(trip.approach.geometry[-1], trip.ride.geometry[0])
        self.assertEqual(trip.approach.duration_seconds, 10)
        self.assertEqual(trip.ride.duration_seconds, 25)
        self.assertEqual(trip.walk.duration_seconds, 10)

        self.graph.segments = [segment for segment in self.graph.segments if segment.id != "stairs"]
        trip = plan_route(self.graph, request)
        self.assertIsNone(trip.approach)
        self.assertEqual(trip.ride.segment_ids, ["detour"])

    def test_off_path_start_has_an_estimated_walk_to_the_network(self) -> None:
        start = MapPoint(latitude=28.05875, longitude=-82.41558)
        trip = plan_route(self.graph, RouteRequest(destination_id="tampa-library", start=start))

        self.assertIsNotNone(trip.approach)
        self.assertEqual(trip.approach.geometry[0], (start.latitude, start.longitude))
        self.assertEqual(trip.approach.geometry[-1], trip.ride.geometry[0])
        self.assertGreater(trip.approach.duration_seconds, 0)

    def test_no_route_when_all_racks_lose_the_walk_connection(self) -> None:
        self.graph.segments = [
            segment for segment in self.graph.segments
            if "walk" not in segment.modes or self.graph.demo.entrance_node not in (segment.from_node, segment.to_node)
        ]
        with self.assertRaisesRegex(RouteUnavailable, "No bike-and-walk trip"):
            plan_route(self.graph, self.library)
