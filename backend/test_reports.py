from pathlib import Path
from tempfile import TemporaryDirectory
from unittest import TestCase
from unittest.mock import patch
from uuid import uuid4

from fastapi import HTTPException

from . import main
from .reports import ReportDraft, ReportStore, ReportVote
from .routing import BIKE_SPEED_MPS, MapPoint, RouteRequest, plan_route


class HazardReportTests(TestCase):
    def setUp(self) -> None:
        folder = self.enterContext(TemporaryDirectory())
        self.path = Path(folder) / "test.sqlite3"
        self.store = ReportStore(self.path)
        self.store.initialize()
        self.enterContext(patch.object(main, "reports", self.store))
        self.segment_id = "osm-43877414-3566360615-557390886"
        a, b = main.reportable_segments[self.segment_id].geometry[:2]
        self.point = MapPoint(latitude=(a[0] + b[0]) / 2, longitude=(a[1] + b[1]) / 2)

    def create_report(self):
        return main.post_report(ReportDraft(
            segment_id=self.segment_id, category="pothole", description="Pothole by Collins Boulevard", point=self.point,
        ))

    def test_hazard_adds_warning_and_safer_detour_until_resolved(self) -> None:
        self.assertEqual(main.get_report_paths(self.point)[0].segment_id, self.segment_id)
        report = self.create_report()
        fast = main.get_route(RouteRequest(destination_id="tampa-library"))
        safer_request = RouteRequest(destination_id="tampa-library", mode="safer")
        safer = main.get_route(safer_request)
        self.assertIn(self.segment_id, fast.ride.segment_ids)
        self.assertEqual(fast.warning_ids, [report.id])
        self.assertNotIn(self.segment_id, safer.ride.segment_ids)
        self.assertEqual(safer.warning_ids, [])

        # Even when every possible riding path is penalized, Safer keeps a route and returns travel time.
        all_path_ids = {segment.id for segment in main.route_graph.segments}
        penalized_trip = plan_route(main.route_graph, safer_request, all_path_ids)
        self.assertAlmostEqual(penalized_trip.ride.duration_seconds, penalized_trip.ride.distance_m / BIKE_SPEED_MPS, places=1)

        main.resolve_report(report.id)
        active = main.get_route(safer_request)
        self.assertEqual(active.ride.segment_ids, fast.ride.segment_ids)
        self.assertEqual(active.warning_ids, [])
        self.assertEqual(main.get_reports(), [])
        self.assertIsNotNone(main.get_admin_reports()[0].resolved_at)

    def test_votes_are_persistent_and_replace_a_riders_previous_choice(self) -> None:
        report = self.create_report()
        first, second = uuid4(), uuid4()
        main.vote_on_report(report.id, ReportVote(rider_id=first, vote="still_there"))
        main.vote_on_report(report.id, ReportVote(rider_id=first, vote="still_there"))
        main.vote_on_report(report.id, ReportVote(rider_id=second, vote="still_there"))
        main.vote_on_report(report.id, ReportVote(rider_id=first, vote="looks_clear"))
        saved = ReportStore(self.path).list_reports()[0]
        self.assertEqual((saved.still_there, saved.looks_clear), (1, 1))
        self.assertIsNotNone(saved.last_confirmed_at)
        main.resolve_report(report.id)
        with self.assertRaises(HTTPException) as error:
            main.vote_on_report(report.id, ReportVote(rider_id=second, vote="looks_clear"))
        self.assertEqual(error.exception.status_code, 404)
        retained = main.get_admin_reports()[0]
        self.assertEqual((retained.still_there, retained.looks_clear), (1, 1))

    def test_report_must_select_a_path_near_the_pin(self) -> None:
        with self.assertRaises(HTTPException) as error:
            main.post_report(ReportDraft(
                segment_id=self.segment_id, category="pothole",
                point=MapPoint(latitude=28.0655, longitude=-82.4186),
            ))
        self.assertEqual(error.exception.status_code, 422)
        self.assertEqual(main.get_reports(), [])
