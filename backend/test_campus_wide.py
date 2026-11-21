from unittest import TestCase
from unittest.mock import patch

from .campus import load_graph
from .campus_wide import load_route_graph, make_map_data
from .routing import MapPoint, RouteRequest, RouteUnavailable, plan_route


class CampusWideRoutingTests(TestCase):
    @classmethod
    def setUpClass(cls) -> None:
        # The checked-in network must still work in a checkout without the USF rack cache.
        with patch("backend.campus_wide.load_racks", side_effect=FileNotFoundError):
            cls.graph = load_route_graph(load_graph())

    def test_pins_across_campus_can_route_without_the_rack_cache(self) -> None:
        start = MapPoint(latitude=28.0655, longitude=-82.4186)
        destination = MapPoint(latitude=28.0561, longitude=-82.4054)
        trip = plan_route(self.graph, RouteRequest(start=start, destination=destination))

        self.assertGreater(trip.ride.distance_m + trip.walk.distance_m, 1000)
        self.assertEqual(trip.ride.geometry[-1], trip.walk.geometry[0])
        self.assertLess(trip.destination_snap_distance_m, 100)

    def test_map_catalog_contains_connected_entrances_outside_the_demo(self) -> None:
        campus = make_map_data(self.graph)
        for name in ("USF Tampa Library", "Yuengling Center", "Phyllis P Marshall Center"):
            with self.subTest(destination=name):
                destination = next(location for location in campus.destinations if location.name == name)
                trip = plan_route(self.graph, RouteRequest(destination_id=destination.id))
                self.assertEqual(trip.walk.geometry[-1], destination.point)

    def test_engineering_plaza_connects_the_two_paths_on_foot(self) -> None:
        plaza_link = next(
            segment for segment in self.graph.segments
            if segment.id == "osm-area-43247700-542782105-542782111"
        )
        self.assertEqual(plaza_link.modes, ["walk"])
        self.assertLess(plaza_link.length_m, 4)

    def test_off_campus_destination_is_rejected(self) -> None:
        with self.assertRaisesRegex(RouteUnavailable, "destination is outside"):
            plan_route(self.graph, RouteRequest(destination=MapPoint(latitude=28.075, longitude=-82.41)))
