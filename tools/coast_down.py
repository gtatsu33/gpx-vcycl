"""
実走GPXの「惰性走行(パワー=0)」区間だけを使ってCdA・Crrを推定するコーストダウン法。
gpx-vcyclアプリ本体とは独立したスタンドアロン解析スクリプト。

物理式（下り惰性走行、power=0）:
  dv/dt = g*sinθ - Crr*g*cosθ - (0.5*ρ*CdA/m)*v²

  θ ≈ 0 の平坦区間専用の単純化式ではなく、勾配ありでも使えるよう
  実測標高から求めた勾配 sinθ を組み込んだ一般形を使用。
  cosθ≈1 とみなし、以下の線形回帰でCrr・CdAを分離する:

    Y = dv/dt - g*sinθ
    X = v²
    Y = intercept + slope * X
    Crr = -intercept / g
    CdA = -slope * 2 * m / ρ

  速度の1階微分(dv/dt)と勾配(dele/ddist)は、GPSノイズの影響を抑えるため
  Savitzky-Golay フィルタで区間全体を滑らかな多項式近似してから解析的に
  微分する（生データの単純差分は取らない）。

使い方:
  python coast_down.py <GPXファイルパス> [--mass 78] [--min-len 30]
"""

import argparse
import math
import re
from datetime import datetime

import numpy as np
from scipy.signal import savgol_filter

G_MS2 = 9.81
RHO_KGM3 = 1.225


def haversine_m(lat1, lon1, lat2, lon2):
    R = 6371000.0
    p1, p2 = math.radians(lat1), math.radians(lat2)
    dphi = math.radians(lat2 - lat1)
    dlmb = math.radians(lon2 - lon1)
    a = math.sin(dphi / 2) ** 2 + math.cos(p1) * math.cos(p2) * math.sin(dlmb / 2) ** 2
    return 2 * R * math.asin(math.sqrt(a))


def parse_gpx(path):
    with open(path, encoding="utf-8") as f:
        content = f.read()
    pts = re.findall(r'<trkpt lat="([-\d.]+)" lon="([-\d.]+)">(.*?)</trkpt>', content, re.S)

    t, lat, lon, ele, power = [], [], [], [], []
    for la, lo, body in pts:
        ele_m = re.search(r"<ele>([-\d.]+)</ele>", body)
        t_m = re.search(r"<time>([^<]+)</time>", body)
        pw_m = re.search(r"<power>(\d+)</power>", body)
        if ele_m is None or t_m is None:
            continue
        t.append(datetime.fromisoformat(t_m.group(1).replace("Z", "+00:00")))
        lat.append(float(la))
        lon.append(float(lo))
        ele.append(float(ele_m.group(1)))
        power.append(int(pw_m.group(1)) if pw_m else 0)

    t0 = t[0]
    t_sec = np.array([(x - t0).total_seconds() for x in t])
    return t_sec, np.array(lat), np.array(lon), np.array(ele), np.array(power, dtype=float)


def find_coast_runs(power, min_len):
    runs = []
    n = len(power)
    i = 0
    while i < n:
        if power[i] == 0:
            j = i
            while j < n and power[j] == 0:
                j += 1
            if j - i >= min_len:
                runs.append((i, j))
            i = j
        else:
            i += 1
    return runs


def analyze_segment(t_sec, lat, lon, ele, a, b, mass_kg):
    t = t_sec[a:b] - t_sec[a]
    n = len(t)
    if n < 15:
        return None

    dist = np.zeros(n)
    for i in range(1, n):
        dist[i] = dist[i - 1] + haversine_m(lat[a + i - 1], lon[a + i - 1], lat[a + i], lon[a + i])

    dt_med = np.median(np.diff(t))
    if dt_med <= 0:
        return None

    window = min(n - (1 - n % 2), 21)
    if window < 5:
        window = 5 if n >= 5 else n - (1 - n % 2)
    if window % 2 == 0:
        window -= 1
    if window < 5:
        return None
    poly = 3 if window > 3 else 2

    v = savgol_filter(dist, window, poly, deriv=1, delta=dt_med)
    dvdt = savgol_filter(dist, window, poly, deriv=2, delta=dt_med)
    dele_dt = savgol_filter(ele[a:b], window, poly, deriv=1, delta=dt_med)

    v_safe = np.where(np.abs(v) < 0.3, np.nan, v)
    grade = dele_dt / v_safe  # sin(theta) 近似

    valid = np.isfinite(grade) & (v > 1.0)  # 低速すぎる端点はノイズが支配的なので除外
    # 区間の端(スプライン端効果でノイズが出やすい)を少し削る
    edge = max(2, window // 4)
    mask = np.zeros(n, dtype=bool)
    mask[edge:n - edge] = True
    valid &= mask

    if valid.sum() < 8:
        return None

    X = v[valid] ** 2
    Y = dvdt[valid] - G_MS2 * grade[valid]

    A = np.vstack([X, np.ones_like(X)]).T
    (slope, intercept), residuals, rank, sv = np.linalg.lstsq(A, Y, rcond=None)

    crr = -intercept / G_MS2
    cda = -slope * 2 * mass_kg / RHO_KGM3

    y_pred = A @ [slope, intercept]
    rms = np.sqrt(np.mean((Y - y_pred) ** 2))
    r2 = 1 - np.sum((Y - y_pred) ** 2) / np.sum((Y - Y.mean()) ** 2) if np.sum((Y - Y.mean()) ** 2) > 0 else float("nan")

    return {
        "n_used": int(valid.sum()),
        "duration_s": float(t[-1]),
        "speed_range_kmh": (float(np.min(v[valid]) * 3.6), float(np.max(v[valid]) * 3.6)),
        "ele_drop_m": float(ele[a] - ele[b - 1]),
        "crr": float(crr),
        "cda": float(cda),
        "rms": float(rms),
        "r2": float(r2),
    }


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("gpx_path")
    ap.add_argument("--mass", type=float, default=80.0)
    ap.add_argument("--min-len", type=int, default=30)
    ap.add_argument("--top", type=int, default=8)
    args = ap.parse_args()

    t_sec, lat, lon, ele, power = parse_gpx(args.gpx_path)
    runs = find_coast_runs(power, args.min_len)
    runs.sort(key=lambda r: -(r[1] - r[0]))
    print(f"惰性走行区間({args.min_len}秒以上): {len(runs)}本 見つかりました\n")

    results = []
    for (a, b) in runs[: args.top]:
        r = analyze_segment(t_sec, lat, lon, ele, a, b, args.mass)
        if r is None:
            continue
        results.append(r)
        lo, hi = r["speed_range_kmh"]
        print(
            f"seg[{a}:{b}] {r['duration_s']:.0f}s  速度{lo:.1f}-{hi:.1f}km/h  "
            f"標高差{r['ele_drop_m']:+.1f}m  n={r['n_used']}  "
            f"CdA={r['cda']:.3f}  Crr={r['crr']:.4f}  R2={r['r2']:.3f}"
        )

    if results:
        cdas = np.array([r["cda"] for r in results])
        crrs = np.array([r["crr"] for r in results])
        print()
        print(f"CdA: median={np.median(cdas):.3f}  mean={cdas.mean():.3f}  std={cdas.std():.3f}")
        print(f"Crr: median={np.median(crrs):.4f}  mean={crrs.mean():.4f}  std={crrs.std():.4f}")


if __name__ == "__main__":
    main()
