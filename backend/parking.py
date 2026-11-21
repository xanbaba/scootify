import json
from pathlib import Path
from tempfile import NamedTemporaryFile
from urllib.parse import urlencode
from urllib.request import Request, urlopen
from uuid import UUID

from pydantic import BaseModel, Field, TypeAdapter


RACKS_FILE = Path(__file__).with_name("data") / "usf-tampa-racks.json"
USF_RACKS_LAYER = (
    "https://gis.usf.edu/fmserver/rest/services/"
    "Campus_Transportation/Parking_Transportation/MapServer/18"
)


class ParkingRack(BaseModel):
    id: UUID
    latitude: float = Field(ge=-90, le=90)
    longitude: float = Field(ge=-180, le=180)
    condition: str | None
    loops: int | None = Field(ge=0)


rack_list = TypeAdapter(list[ParkingRack])


def load_racks() -> list[ParkingRack]:
    return rack_list.validate_json(RACKS_FILE.read_bytes())


def import_racks() -> list[ParkingRack]:
    params = {
        "where": "Campus = 'TPA'",
        "outFields": "GlobalID,Campus,Condition,BikeLoops",
        "returnGeometry": "true",
        "outSR": "4326",
        "f": "geojson",
    }
    request = Request(f"{USF_RACKS_LAYER}/query?{urlencode(params)}")
    with urlopen(request, timeout=20) as response:
        collection = json.load(response)

    if (
        collection.get("type") != "FeatureCollection"
        or collection.get("exceededTransferLimit")
        or collection.get("properties", {}).get("exceededTransferLimit")
    ):
        raise ValueError("USF did not return a complete bike-rack inventory")

    racks = []
    for feature in collection["features"]:
        geometry = feature["geometry"]
        properties = feature["properties"]
        if geometry["type"] != "Point" or properties["Campus"] != "TPA":
            raise ValueError("USF returned an unexpected rack feature")
        longitude, latitude = geometry["coordinates"]
        racks.append(
            ParkingRack(
                id=UUID(properties["GlobalID"]),
                latitude=latitude,
                longitude=longitude,
                condition=properties["Condition"],
                loops=properties["BikeLoops"],
            )
        )

    if not racks or len({rack.id for rack in racks}) != len(racks):
        raise ValueError("USF returned an empty inventory or duplicate rack IDs")

    RACKS_FILE.parent.mkdir(parents=True, exist_ok=True)
    temporary_path = None
    try:
        with NamedTemporaryFile(
            dir=RACKS_FILE.parent, prefix="usf-tampa-racks.", suffix=".tmp", delete=False
        ) as temporary_file:
            temporary_path = Path(temporary_file.name)
            temporary_file.write(rack_list.dump_json(racks))
        temporary_path.replace(RACKS_FILE)
    finally:
        if temporary_path is not None:
            temporary_path.unlink(missing_ok=True)

    return racks


if __name__ == "__main__":
    print(f"Imported {len(import_racks())} USF Tampa parking racks.")
