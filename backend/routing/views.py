from __future__ import annotations

import logging
from datetime import datetime, timedelta, timezone

from rest_framework import serializers, status
from rest_framework.decorators import api_view
from rest_framework.request import Request
from rest_framework.response import Response

from . import services
from .clients import photon
from .clients.http import UpstreamError

log = logging.getLogger(__name__)


class PlaceSerializer(serializers.Serializer):
    lat = serializers.FloatField(min_value=-90, max_value=90)
    lon = serializers.FloatField(min_value=-180, max_value=180)
    label = serializers.CharField(required=False, allow_blank=True, max_length=200)


class PlanSerializer(serializers.Serializer):
    origin = PlaceSerializer()
    destination = PlaceSerializer()
    departure = serializers.DateTimeField()
    load_lbs = serializers.IntegerField(min_value=0, max_value=200_000)
    interval_miles = serializers.ChoiceField(choices=[10, 25, 50])

    def validate_departure(self, value: datetime) -> datetime:
        now = datetime.now(timezone.utc)
        if value < now - timedelta(hours=1):
            raise serializers.ValidationError("Departure can't be in the past.")
        if value > now + timedelta(days=13):
            raise serializers.ValidationError("Forecasts only reach about two weeks ahead.")
        return value

    def validate(self, attrs: dict) -> dict:
        o, d = attrs["origin"], attrs["destination"]
        if abs(o["lat"] - d["lat"]) < 1e-4 and abs(o["lon"] - d["lon"]) < 1e-4:
            raise serializers.ValidationError("Origin and destination are the same place.")
        return attrs


@api_view(["GET"])
def health(_: Request) -> Response:
    return Response({"status": "ok"})


@api_view(["GET"])
def geocode(request: Request) -> Response:
    query = request.query_params.get("q", "").strip()
    if len(query) < 2:
        return Response({"results": []})
    try:
        return Response({"results": photon.search(query)})
    except UpstreamError as exc:
        return Response({"detail": str(exc)}, status=status.HTTP_502_BAD_GATEWAY)


@api_view(["POST"])
def plan(request: Request) -> Response:
    body = PlanSerializer(data=request.data)
    body.is_valid(raise_exception=True)
    data = body.validated_data
    try:
        result = services.plan_trip(
            origin=(data["origin"]["lon"], data["origin"]["lat"]),
            destination=(data["destination"]["lon"], data["destination"]["lat"]),
            departure=data["departure"],
            load_lbs=data["load_lbs"],
            interval_miles=int(data["interval_miles"]),
        )
    except UpstreamError as exc:
        log.warning("plan failed: %s", exc)
        return Response({"detail": str(exc)}, status=status.HTTP_502_BAD_GATEWAY)
    return Response(result)
