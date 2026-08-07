"""
実走GPXから「定常走行区間(平坦・一定パワー)」の候補をスライディングウィンドウで探す。
gpx-vcyclアプリ本体とは独立したスタンドアロン解析スクリプト。

平均値法（微分を使わない）でCdA・Crrを分離するための下準備。
各候補区間について、区間合計距離÷合計時間の平均速度・平均パワー・平均勾配を出す。

使い方:
  python find_steady_segments.py <GPXファイルパス> [--window 180] [--max-grade 1.5] [--max-power-cv 0.15]
"""

import argparse
import sys

import numpy as np

sys.path.insert(0, __file__.rsplit("\\", 1)[0])
from calibrate_physics import parse_gpx, resample  # noqa: E402


def scan(t, dt, speed, ele, power, window_sec, max_grade_pct, max_power_cv, min_speed_kmh):
    bin_sec = np.median(dt)
    win_bins = max(3, int(round(window_sec / bin_sec)))

    n = len(t)
    candidates = []
    for start in range(0, n - win_bins):
        end = start + win_bins
        seg_dt = dt[start:end]
        seg_power = power[start:end]
        seg_speed = speed[start:end]
        seg_ele = ele[start:end]

        if np.any(seg_speed < 0.5):  # 停止を含む区間は除外
            continue

        duration = seg_dt.sum()
        distance = np.sum(seg_speed * seg_dt)
        if distance <= 0:
            continue

        avg_speed = distance / duration
        avg_power = seg_power.mean()
        power_cv = seg_power.std() / avg_power if avg_power > 0 else np.inf

        ele_change = seg_ele[-1] - seg_ele[0]
        grade_pct = 100 * ele_change / distance

        if power_cv > max_power_cv:
            continue
        if abs(grade_pct) > max_grade_pct:
            continue
        if avg_speed * 3.6 < min_speed_kmh:
            continue

        candidates.append({
            "start": start, "end": end,
            "duration_s": duration,
            "distance_m": distance,
            "avg_speed_kmh": avg_speed * 3.6,
            "avg_power_w": avg_power,
            "power_cv": power_cv,
            "grade_pct": grade_pct,
        })
    return candidates


def dedupe_overlaps(cands, win_bins):
    cands = sorted(cands, key=lambda c: c["power_cv"] + abs(c["grade_pct"]) * 0.05)
    picked = []
    used = np.zeros(0)
    taken_ranges = []
    for c in cands:
        overlap = any(not (c["end"] <= s or c["start"] >= e) for s, e in taken_ranges)
        if overlap:
            continue
        taken_ranges.append((c["start"], c["end"]))
        picked.append(c)
    return picked


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("gpx_path")
    ap.add_argument("--window", type=float, default=180.0, help="ウィンドウ長[秒]")
    ap.add_argument("--max-grade", type=float, default=1.5, help="許容する平均勾配の絶対値[%]")
    ap.add_argument("--max-power-cv", type=float, default=0.15, help="パワーの変動係数(std/mean)上限")
    ap.add_argument("--min-speed", type=float, default=8.0, help="平均速度の下限[km/h]")
    ap.add_argument("--top", type=int, default=15)
    ap.add_argument("--mass", type=float, default=80.0, help="rider+bike質量[kg]")
    args = ap.parse_args()

    t_sec, lat, lon, ele, power = parse_gpx(args.gpx_path)
    t, dt, speed, ele_s, power_r = resample(t_sec, lat, lon, ele, power)

    cands = scan(t, dt, speed, ele_s, power_r, args.window, args.max_grade, args.max_power_cv, args.min_speed)
    print(f"条件を満たす候補ウィンドウ(重複含む): {len(cands)}")

    win_bins = max(3, int(round(args.window / np.median(dt))))
    picked = dedupe_overlaps(cands, win_bins)
    print(f"重複除去後の候補区間: {len(picked)}\n")

    for c in picked[: args.top]:
        print(
            f"t={t[c['start']]:.0f}-{t[c['end']]:.0f}s ({c['duration_s']:.0f}s)  "
            f"距離{c['distance_m']:.0f}m  平均速度{c['avg_speed_kmh']:.1f}km/h  "
            f"平均パワー{c['avg_power_w']:.0f}W(CV={c['power_cv']:.2f})  "
            f"勾配{c['grade_pct']:+.2f}%"
        )

    fit_cda_crr(picked, args.mass)


def fit_cda_crr(cands, mass_kg):
    G_MS2 = 9.81
    RHO_KGM3 = 1.225

    if len(cands) < 2:
        print("\n定常区間が2本未満のためCdA/Crrの分離フィットはできません。")
        return

    rows, targets = [], []
    for c in cands:
        v = c["avg_speed_kmh"] / 3.6
        theta = np.arctan(c["grade_pct"] / 100)
        p_gravity = mass_kg * G_MS2 * np.sin(theta) * v
        rows.append([mass_kg * G_MS2 * np.cos(theta) * v, 0.5 * RHO_KGM3 * v ** 3])
        targets.append(c["avg_power_w"] - p_gravity)

    A = np.array(rows)
    b = np.array(targets)
    (crr, cda), residuals, rank, sv = np.linalg.lstsq(A, b, rcond=None)

    pred = A @ [crr, cda]
    print("\n=== 定常区間の平均値法によるCdA/Crrフィット ===")
    print(f"使用区間数: {len(cands)}  質量: {mass_kg:.1f}kg")
    print(f"Crr (推定): {crr:.5f}   (アプリ既定値 0.005)")
    print(f"CdA (推定): {cda:.4f} m²  (アプリ既定値 0.32)")
    for c, p in zip(cands, pred):
        print(f"  実測P={c['avg_power_w']:.0f}W  モデル予測P(重力分含む)="
              f"{p + mass_kg*G_MS2*np.sin(np.arctan(c['grade_pct']/100))*(c['avg_speed_kmh']/3.6):.0f}W")


if __name__ == "__main__":
    main()
