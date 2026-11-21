"use client";

import { useState, useEffect, useCallback, useRef } from "react";
import { MapContainer, TileLayer, Marker, Circle, CircleMarker, Popup, useMap, useMapEvents } from "react-leaflet";
import { useAppToast } from "@/components/app-toast-provider";
import { useTranslations } from "next-intl";

export type ZoneCaptureValue = {
  latitude: number;
  longitude: number;
  radiusMeters: number;
  accuracy: number | null;
  placeName: string | null;
  saveAsZone: boolean;
  zoneName: string | null;
  zoneId: string | null;
};

const DEFAULT_RADIUS = 100;
const MIN_RADIUS = 10;
const MAX_RADIUS = 1000;
const POOR_ACCURACY_METERS = 30;
const DEFAULT_CENTER: [number, number] = [30.0444, 31.2357];

function positionToValue(position: GeolocationPosition): { latitude: number; longitude: number; accuracy: number } {
  return {
    latitude: position.coords.latitude,
    longitude: position.coords.longitude,
    accuracy: position.coords.accuracy,
  };
}

function MapClickHandler({ onPick }: { onPick: (lat: number, lng: number) => void }) {
  useMapEvents({
    click(event) {
      onPick(event.latlng.lat, event.latlng.lng);
    },
  });
  return null;
}

function MapResizeHandler() {
  const map = useMap();
  useEffect(() => {
    const container = map.getContainer();
    const invalidate = () => map.invalidateSize();
    const raf = requestAnimationFrame(invalidate);
    const timeout = window.setTimeout(invalidate, 200);
    let observer: ResizeObserver | null = null;
    if (typeof ResizeObserver !== "undefined") {
      observer = new ResizeObserver(() => invalidate());
      observer.observe(container);
      if (container.parentElement) observer.observe(container.parentElement);
    }
    window.addEventListener("resize", invalidate);
    return () => {
      cancelAnimationFrame(raf);
      window.clearTimeout(timeout);
      window.removeEventListener("resize", invalidate);
      observer?.disconnect();
    };
  }, [map]);
  return null;
}

export default function ZoneCapture({
  value,
  onChange,
}: {
  value: Partial<ZoneCaptureValue>;
  onChange: (value: ZoneCaptureValue) => void;
}) {
  const t = useTranslations("site.attendance");
  const showToast = useAppToast();
  const onChangeRef = useRef(onChange);
  onChangeRef.current = onChange;

  const [locating, setLocating] = useState(false);
  const [locateError, setLocateError] = useState<string | null>(null);
  const [manual, setManual] = useState(false);
  const [point, setPoint] = useState<[number, number]>([
    value.latitude ?? DEFAULT_CENTER[0],
    value.longitude ?? DEFAULT_CENTER[1],
  ]);
  const [accuracy, setAccuracy] = useState<number | null>(value.accuracy ?? null);
  const [radiusMeters, setRadiusMeters] = useState(value.radiusMeters ?? DEFAULT_RADIUS);
  const [placeName, setPlaceName] = useState(value.placeName ?? null);
  const [saveAsZone, setSaveAsZone] = useState(!!value.saveAsZone);
  const [zoneName, setZoneName] = useState(value.zoneName ?? null);

  const accuracyWarning = accuracy !== null && accuracy > POOR_ACCURACY_METERS;

  useEffect(() => {
    onChangeRef.current({
      latitude: point[0],
      longitude: point[1],
      radiusMeters: Math.min(MAX_RADIUS, Math.max(MIN_RADIUS, Number(radiusMeters) || DEFAULT_RADIUS)),
      accuracy,
      placeName: placeName || null,
      saveAsZone,
      zoneName: saveAsZone ? (zoneName || null) : null,
      zoneId: saveAsZone ? (value.zoneId || null) : null,
    });
  }, [point, accuracy, radiusMeters, placeName, saveAsZone, zoneName, value.zoneId]);

  const handlePick = useCallback((lat: number, lng: number) => {
    setPoint([lat, lng]);
    setAccuracy(null);
    setManual(true);
    setLocateError(null);
  }, []);

  const requestLocation = useCallback(() => {
    if (!("geolocation" in navigator)) {
      setLocateError(t("locationUnavailable"));
      setManual(true);
      return;
    }
    setLocating(true);
    setLocateError(null);
    navigator.geolocation.getCurrentPosition(
      (position) => {
        const { latitude, longitude, accuracy: acc } = positionToValue(position);
        setPoint([latitude, longitude]);
        setAccuracy(acc);
        setLocating(false);
        setManual(false);
        setLocateError(null);
        if (acc > POOR_ACCURACY_METERS) {
          showToast(t("accuracyWarning", { meters: Math.round(acc) }));
        }
      },
      (error) => {
        setLocating(false);
        setManual(true);
        switch (error.code) {
          case error.PERMISSION_DENIED:
            setLocateError(t("locationDenied"));
            break;
          case error.POSITION_UNAVAILABLE:
            setLocateError(t("locationUnavailable"));
            break;
          default:
            setLocateError(t("locationFailed"));
        }
      },
      { enableHighAccuracy: true, timeout: 15_000, maximumAge: 0 },
    );
  }, [showToast, t]);

  const retry = () => {
    setLocateError(null);
    setManual(false);
    requestLocation();
  };

  const presets = [10, 50, 100, 200, 500];
  const clampedRadius = Math.min(MAX_RADIUS, Math.max(MIN_RADIUS, Number(radiusMeters) || DEFAULT_RADIUS));

  return (
    <section className="zone-capture admin-form-wide" aria-label="Attendance zone">
      <div className="zone-capture-header">
        <h2>{t("zoneSetup")}</h2>
        <div className="zone-actions">
          <button
            type="button"
            className="button button-primary"
            disabled={locating}
            onClick={retry}
          >
            {locating ? t("locating") : t("useMyLocation")}
          </button>
          {(manual || locateError) ? (
            <button type="button" className="button button-secondary" onClick={() => setManual((v) => !v)}>
              {t("adjustPin")}
            </button>
          ) : null}
        </div>
      </div>
      {locateError && (
        <p className="form-error" role="alert">{locateError}</p>
      )}
      {manual && (
        <p className="empty-note zone-capture-note">{t("clickMapToAdjust")}</p>
      )}
      <div className="zone-map-wrap">
        <MapContainer center={point} zoom={16} scrollWheelZoom className="zone-leaflet-map">
          <MapResizeHandler />
          <TileLayer
            attribution='&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors'
            url="https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png"
          />
          <MapClickHandler onPick={handlePick} />
          <Marker position={point}>
            <Popup>{t("zoneCenter")}</Popup>
          </Marker>
          <Circle center={point} radius={clampedRadius} pathOptions={{ color: "var(--a)", weight: 2, fillOpacity: 0.14 }} />
          <CircleMarker center={point} radius={7} pathOptions={{ color: "#fff", weight: 2, fillColor: "#176f78", fillOpacity: 1 }} />
        </MapContainer>
      </div>
      <div className="zone-meta">
        {accuracy !== null && (
          <p className={accuracyWarning ? "form-error" : "form-message"} role="status">
            {t("accuracy", { meters: Math.round(accuracy) })}
          </p>
        )}
        {accuracyWarning && (
          <p className="warning-note">{t("poorAccuracyHint")}</p>
        )}
      </div>
      <div className="zone-capture-grid">
        <label>
          {t("zoneRadius")}
          <input
            type="number"
            min={MIN_RADIUS}
            max={MAX_RADIUS}
            value={radiusMeters}
            onChange={(event) => setRadiusMeters(Number(event.target.value))}
            required
          />
        </label>
        <div className="radius-presets-wrap">
          <span className="zone-field-label">{t("zoneRadius")}</span>
          <div className="radius-presets">
            {presets.map((meters) => (
              <button
                key={meters}
                type="button"
                className={`button ${Number(radiusMeters) === meters ? "button-primary" : "button-secondary"} radius-pill`}
                onClick={() => setRadiusMeters(meters)}
              >
                {meters} m
              </button>
            ))}
          </div>
        </div>
        <label className="radius-slider-label admin-form-wide">
          {t("zoneRadius")} ({clampedRadius} m)
          <input
            type="range"
            min={MIN_RADIUS}
            max={MAX_RADIUS}
            step={10}
            value={clampedRadius}
            onChange={(event) => setRadiusMeters(Number(event.target.value))}
          />
        </label>
        <p className="empty-note admin-form-wide zone-capture-note">{t("zoneRadiusHint")}</p>
        <label>
          {t("placeName")}
          <input value={placeName ?? ""} onChange={(event) => setPlaceName(event.target.value)} maxLength={100} />
        </label>
        <label className="zone-save-toggle visibility-control">
          <input type="checkbox" checked={saveAsZone} onChange={(event) => setSaveAsZone(event.target.checked)} />
          <span>{t("saveAsZone")}</span>
        </label>
        {saveAsZone && (
          <label>
            {t("zoneName")}
            <input value={zoneName ?? ""} onChange={(event) => setZoneName(event.target.value)} required maxLength={100} />
          </label>
        )}
      </div>
    </section>
  );
}
