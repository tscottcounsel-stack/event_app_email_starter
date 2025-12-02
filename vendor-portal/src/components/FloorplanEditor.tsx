// vendor-portal/src/components/FloorplanEditor.tsx
import React, { useEffect, useMemo, useRef, useState } from "react";
import { Stage, Layer, Image as KonvaImage, Rect, Circle, Group, Text, Line, Transformer } from "react-konva";

type Slot = {
  id: number;
  label: string;
  shape: "rect" | "circle" | "poly";
  // rect
  x_norm?: number; y_norm?: number; w_norm?: number; h_norm?: number; rotation_deg?: number;
  // circle
  cx_norm?: number; cy_norm?: number; r_norm?: number;
  // poly
  points_norm?: number[][];
  z_index?: number | null;
  label_x_norm?: number | null;
  label_y_norm?: number | null;
};

type Diagram = {
  image_url: string;
  natural_width_px: number;
  natural_height_px: number;
  grid_px?: number | null;
};

type Props = {
  baseUrl: string;             // e.g., "http://127.0.0.1:8011"
  eventId: number;             // e.g., 38
  authToken: string;           // "Bearer <jwt>"
  width?: number;              // canvas width; height auto by aspect ratio
};

function useImage(url?: string) {
  const [img, setImg] = useState<HTMLImageElement | null>(null);
  useEffect(() => {
    if (!url) return;
    const i = new window.Image();
    i.crossOrigin = "anonymous";
    i.onload = () => setImg(i);
    i.src = url;
  }, [url]);
  return img;
}

export default function FloorplanEditor({ baseUrl, eventId, authToken, width = 900 }: Props) {
  const [diagram, setDiagram] = useState<Diagram | null>(null);
  const [slots, setSlots] = useState<Slot[]>([]);
  const [selectedId, setSelectedId] = useState<number | null>(null);

  const bg = useImage(diagram?.image_url);

  const aspect = useMemo(() => {
    if (!diagram) return 1;
    return diagram.natural_height_px / diagram.natural_width_px;
  }, [diagram]);

  const drawW = width;
  const drawH = Math.round(width * aspect);

  const headers = useMemo(() => ({ Authorization: authToken }), [authToken]);

  // Load data
  useEffect(() => {
    (async () => {
      const d = await fetch(`${baseUrl}/organizer/events/${eventId}/diagram`, { headers }).then(r => r.ok ? r.json() : null);
      if (d) setDiagram(d);
      const s = await fetch(`${baseUrl}/organizer/events/${eventId}/slots?size=2000&order_by=natlabel`, { headers }).then(r => r.json());
      setSlots(s.items);
    })();
  }, [baseUrl, eventId, headers]);

  // Helpers: norm<->px
  const toPx = (nx?: number | null) => (nx ?? 0) * drawW;
  const toPxY = (ny?: number | null) => (ny ?? 0) * drawH;
  const toNormX = (px: number) => Math.min(1, Math.max(0, px / drawW));
  const toNormY = (py: number) => Math.min(1, Math.max(0, py / drawH));

  const saveGeometry = async (slot: Slot) => {
    const url = `${baseUrl}/organizer/slots/${slot.id}/geometry`;
    let geometry: any;
    if (slot.shape === "rect") {
      geometry = {
        shape: "rect",
        x_norm: slot.x_norm ?? 0, y_norm: slot.y_norm ?? 0,
        w_norm: slot.w_norm ?? 0, h_norm: slot.h_norm ?? 0,
        rotation_deg: slot.rotation_deg ?? 0,
        label_x_norm: slot.label_x_norm ?? null,
        label_y_norm: slot.label_y_norm ?? null,
        z_index: slot.z_index ?? null
      };
    } else if (slot.shape === "circle") {
      geometry = {
        shape: "circle",
        cx_norm: slot.cx_norm ?? 0, cy_norm: slot.cy_norm ?? 0, r_norm: slot.r_norm ?? 0,
        label_x_norm: slot.label_x_norm ?? null,
        label_y_norm: slot.label_y_norm ?? null,
        z_index: slot.z_index ?? null
      };
    } else {
      geometry = {
        shape: "poly",
        points_norm: slot.points_norm ?? [[0.1,0.1],[0.2,0.1],[0.2,0.2]],
        label_x_norm: slot.label_x_norm ?? null,
        label_y_norm: slot.label_y_norm ?? null,
        z_index: slot.z_index ?? null
      };
    }
    const resp = await fetch(url, {
      method: "PATCH",
      headers: { ...headers, "Content-Type": "application/json" },
      body: JSON.stringify(geometry)
    });
    if (!resp.ok) {
      console.error("saveGeometry failed", await resp.text());
    }
  };

  // --- Selection transformer for rects ---
  const trRef = useRef<any>(null);
  const rectRef = useRef<any>(null);
  useEffect(() => {
    if (trRef.current && rectRef.current && selectedId != null) {
      trRef.current.nodes([rectRef.current]);
      trRef.current.getLayer()?.batchDraw();
    }
  }, [selectedId]);

  return (
    <div className="w-full flex flex-col gap-2">
      <Stage width={drawW} height={drawH} style={{ border: "1px solid #eee", borderRadius: 8 }}>
        <Layer>
          {bg && <KonvaImage image={bg} width={drawW} height={drawH} perfectDrawEnabled={false} />}

          {/* grid (optional visual aid) */}
          {diagram?.grid_px && diagram.grid_px > 0 && Array.from({ length: Math.floor(drawW / diagram.grid_px) + 1 }).map((_, ix) => (
            <Line key={`v${ix}`} points={[ix * (diagram.grid_px ?? 0), 0, ix * (diagram.grid_px ?? 0), drawH]} stroke="#ddd" strokeWidth={1} />
          ))}
          {diagram?.grid_px && diagram.grid_px > 0 && Array.from({ length: Math.floor(drawH / diagram.grid_px) + 1 }).map((_, iy) => (
            <Line key={`h${iy}`} points={[0, iy * (diagram.grid_px ?? 0), drawW, iy * (diagram.grid_px ?? 0)]} stroke="#ddd" strokeWidth={1} />
          ))}

          {[...slots]
            .sort((a, b) => (a.z_index ?? 0) - (b.z_index ?? 0) || a.label.localeCompare(b.label))
            .map((s) => {
              const common = {
                key: s.id,
                onClick: () => setSelectedId(s.id),
                onTap: () => setSelectedId(s.id),
              };

              if (s.shape === "circle") {
                const cx = toPx(s.cx_norm), cy = toPxY(s.cy_norm), r = Math.min(toPx(s.r_norm), toPxY(s.r_norm));
                return (
                  <Group {...common}>
                    <Circle
                      x={cx}
                      y={cy}
                      radius={r}
                      fillEnabled={false}
                      stroke={selectedId === s.id ? "#1d4ed8" : "#111827"}
                      strokeWidth={selectedId === s.id ? 3 : 1.5}
                      draggable
                      onDragEnd={(evt) => {
                        const { x, y } = evt.target.position();
                        const nx = toNormX(x), ny = toNormY(y);
                        s.cx_norm = nx; s.cy_norm = ny;
                        saveGeometry(s);
                      }}
                    />
                    <Text x={cx - 9999} y={cy - 9999} /> {/* Konva font warm-up */}
                    <Text
                      x={toPx(s.label_x_norm ?? s.cx_norm)}
                      y={toPxY(s.label_y_norm ?? s.cy_norm)}
                      text={s.label}
                      fontSize={14}
                      fill="#111827"
                      offsetX={20}
                      offsetY={-10}
                    />
                  </Group>
                );
              }

              if (s.shape === "poly" && s.points_norm && s.points_norm.length >= 3) {
                const pts = s.points_norm.flatMap(([nx, ny]) => [toPx(nx), toPxY(ny)]);
                const centroid = s.points_norm.reduce(([sx, sy], [nx, ny]) => [sx + nx, sy + ny], [0, 0]).map(v => v / s.points_norm!.length) as [number, number];
                const [cx, cy] = [toPx(centroid[0]), toPxY(centroid[1])];

                return (
                  <Group {...common}>
                    <Line
                      points={pts}
                      closed
                      fillEnabled={false}
                      stroke={selectedId === s.id ? "#1d4ed8" : "#111827"}
                      strokeWidth={selectedId === s.id ? 3 : 1.5}
                    />
                    <Text
                      x={toPx(s.label_x_norm ?? centroid[0])}
                      y={toPxY(s.label_y_norm ?? centroid[1])}
                      text={s.label}
                      fontSize={14}
                      fill="#111827"
                      offsetX={20}
                      offsetY={-10}
                    />
                  </Group>
                );
              }

              // default rect
              const x = toPx(s.x_norm), y = toPxY(s.y_norm), w = toPx(s.w_norm), h = toPxY(s.h_norm);
              const isSelected = selectedId === s.id;

              return (
                <Group {...common}>
                  <Rect
                    ref={isSelected ? rectRef : undefined}
                    x={x} y={y} width={w} height={h}
                    rotation={s.rotation_deg ?? 0}
                    fillEnabled={false}
                    stroke={isSelected ? "#1d4ed8" : "#111827"}
                    strokeWidth={isSelected ? 3 : 1.5}
                    draggable
                    onDragEnd={(evt) => {
                      const { x: px, y: py } = evt.target.position();
                      s.x_norm = toNormX(px); s.y_norm = toNormY(py);
                      saveGeometry(s);
                    }}
                    onTransformEnd={(evt) => {
                      const node = rectRef.current;
                      const scaleX = node.scaleX();
                      const scaleY = node.scaleY();
                      const newW = Math.max(10, node.width() * scaleX);
                      const newH = Math.max(10, node.height() * scaleY);
                      node.scaleX(1); node.scaleY(1);

                      s.x_norm = toNormX(node.x());
                      s.y_norm = toNormY(node.y());
                      s.w_norm = toNormX(newW);
                      s.h_norm = toNormY(newH);
                      s.rotation_deg = node.rotation();
                      saveGeometry(s);
                    }}
                  />
                  {isSelected && (
                    <Transformer
                      ref={trRef}
                      rotateEnabled={true}
                      enabledAnchors={["top-left","top-right","bottom-left","bottom-right"]}
                      boundBoxFunc={(oldBox, newBox) => newBox.width < 10 || newBox.height < 10 ? oldBox : newBox}
                    />
                  )}
                  <Text
                    x={toPx(s.label_x_norm ?? (s.x_norm! + (s.w_norm ?? 0)/2))}
                    y={toPxY(s.label_y_norm ?? (s.y_norm! + (s.h_norm ?? 0)/2))}
                    text={s.label}
                    fontSize={14}
                    fill="#111827"
                    offsetX={20}
                    offsetY={-10}
                  />
                </Group>
              );
            })}
        </Layer>
      </Stage>
    </div>
  );
}
