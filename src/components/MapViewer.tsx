import React, { useEffect } from 'react';
import { MapContainer, TileLayer, Marker, Popup, useMap } from 'react-leaflet';
import 'leaflet/dist/leaflet.css';
import L from 'leaflet';

// Fix for default marker icons in React-Leaflet
import icon from 'leaflet/dist/images/marker-icon.png';
import iconShadow from 'leaflet/dist/images/marker-shadow.png';

let DefaultIcon = L.icon({
    iconUrl: icon,
    shadowUrl: iconShadow,
    iconSize: [25, 41],
    iconAnchor: [12, 41]
});

L.Marker.prototype.options.icon = DefaultIcon;

interface Place {
  name: string;
  location: { lat: number; lng: number };
  address?: string;
  uri?: string;
}

interface MapViewerProps {
  center: { lat: number; lng: number };
  places: Place[];
  zoom?: number;
}

// Component to update map center when props change
const MapUpdater: React.FC<{ center: { lat: number; lng: number } }> = ({ center }) => {
  const map = useMap();
  useEffect(() => {
    map.setView([center.lat, center.lng], map.getZoom());
  }, [center, map]);
  return null;
};

export const MapViewer: React.FC<MapViewerProps> = ({ center, places, zoom = 13 }) => {
  return (
    <div style={{ height: '300px', width: '100%', borderRadius: '12px', overflow: 'hidden', marginTop: '12px', border: '1px solid var(--border-modal)' }}>
      <MapContainer 
        center={[center.lat, center.lng]} 
        zoom={zoom} 
        style={{ height: '100%', width: '100%' }}
      >
        <TileLayer
          attribution='&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors &copy; <a href="https://carto.com/attributions">CARTO</a>'
          url="https://{s}.basemaps.cartocdn.com/dark_all/{z}/{x}/{y}{r}.png"
        />
        <MapUpdater center={center} />
        
        {/* User Location Marker (different color if possible, for now default) */}
        <Marker position={[center.lat, center.lng]}>
            <Popup>
                Tu ubicación aproximada
            </Popup>
        </Marker>

        {places.map((place, index) => (
          <Marker key={index} position={[place.location.lat, place.location.lng]}>
            <Popup>
              <div style={{ minWidth: '150px' }}>
                <strong style={{ display: 'block', marginBottom: '4px', fontSize: '14px' }}>{place.name}</strong>
                {place.address && <span style={{ fontSize: '12px', display: 'block', marginBottom: '8px', color: '#666' }}>{place.address}</span>}
                {place.uri && (
                  <a 
                    href={place.uri} 
                    target="_blank" 
                    rel="noopener noreferrer"
                    style={{ 
                        fontSize: '12px', 
                        color: '#007bff', 
                        textDecoration: 'none',
                        fontWeight: 600
                    }}
                  >
                    Ver en Google Maps &rarr;
                  </a>
                )}
              </div>
            </Popup>
          </Marker>
        ))}
      </MapContainer>
    </div>
  );
};
