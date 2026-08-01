import React, { useEffect, useRef } from 'react';
import type { TrendPoint } from '../../types/api';

interface Props {
  points: TrendPoint[];
  height?: number;
}

/** 轻量良率折线图（原生 canvas，不引入图表依赖）。 */
export const TrendChart: React.FC<Props> = ({ points, height = 180 }) => {
  const canvasRef = useRef<HTMLCanvasElement | null>(null);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;

    const draw = () => {
      const parent = canvas.parentElement;
      const width = parent ? parent.clientWidth : 600;
      if (width <= 0) return;
      const dpr = window.devicePixelRatio || 1;
      canvas.width = width * dpr;
      canvas.height = height * dpr;
      canvas.style.width = `${width}px`;
      canvas.style.height = `${height}px`;
      const ctx = canvas.getContext('2d');
      if (!ctx) return;
      ctx.scale(dpr, dpr);
      ctx.clearRect(0, 0, width, height);

      const valid = points
        .map((p, index) => ({ p, index, rate: p.yield_rate == null ? NaN : p.yield_rate }))
        .filter(item => Number.isFinite(item.rate));
      const pad = { top: 10, right: 12, bottom: 24, left: 42 };
      const plotW = width - pad.left - pad.right;
      const plotH = height - pad.top - pad.bottom;

      if (valid.length === 0) {
        ctx.fillStyle = '#9ca3af';
        ctx.font = '12px sans-serif';
        ctx.textAlign = 'center';
        ctx.fillText('暂无趋势数据', width / 2, height / 2);
        return;
      }

      const rates = valid.map(item => item.rate);
      const min = Math.min(0, ...rates);
      const max = Math.max(1, ...rates);
      const xFor = (index: number) =>
        pad.left + (valid.length === 1 ? plotW / 2 : (index / (valid.length - 1)) * plotW);
      const yFor = (rate: number) => pad.top + (1 - (rate - min) / (max - min)) * plotH;

      // 网格 + Y 轴刻度
      ctx.strokeStyle = '#e5e7eb';
      ctx.fillStyle = '#9ca3af';
      ctx.font = '10px sans-serif';
      ctx.textAlign = 'right';
      ctx.lineWidth = 1;
      for (let g = 0; g <= 4; g++) {
        const rate = min + ((max - min) * g) / 4;
        const y = yFor(rate);
        ctx.beginPath();
        ctx.moveTo(pad.left, y);
        ctx.lineTo(width - pad.right, y);
        ctx.stroke();
        ctx.fillText(`${(rate * 100).toFixed(0)}%`, pad.left - 6, y + 3);
      }

      // 折线
      ctx.strokeStyle = '#10b981';
      ctx.lineWidth = 2;
      ctx.lineJoin = 'round';
      ctx.beginPath();
      valid.forEach((item, i) => {
        const x = xFor(item.index);
        const y = yFor(item.rate);
        if (i === 0) ctx.moveTo(x, y);
        else ctx.lineTo(x, y);
      });
      ctx.stroke();

      // 数据点
      ctx.fillStyle = '#10b981';
      valid.forEach(item => {
        ctx.beginPath();
        ctx.arc(xFor(item.index), yFor(item.rate), 3, 0, Math.PI * 2);
        ctx.fill();
      });

      // X 轴标签
      ctx.fillStyle = '#9ca3af';
      ctx.textAlign = 'center';
      const labelEvery = Math.max(1, Math.ceil(valid.length / 6));
      valid.forEach((item, i) => {
        if (i % labelEvery !== 0 && i !== valid.length - 1) return;
        ctx.fillText(item.p.time, xFor(item.index), height - 8);
      });
    };

    draw();
    const observer = typeof ResizeObserver !== 'undefined'
      ? new ResizeObserver(draw)
      : undefined;
    if (observer && canvas.parentElement) observer.observe(canvas.parentElement);
    return () => { observer?.disconnect(); };
  }, [points, height]);

  if (points.length === 0) {
    return <div className="text-xs text-text-tertiary text-center py-6">暂无趋势数据</div>;
  }
  return <canvas ref={canvasRef} className="w-full" style={{ height }} />;
};
