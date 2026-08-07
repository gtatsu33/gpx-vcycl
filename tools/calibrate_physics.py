"""
実走GPXデータからCdA（空気抵抗）とCrr（転がり抵抗）を推定するスタンドアロン解析スクリプト。
gpx-vcyclアプリ本体とは独立。src/domain/physics.js の物理モデルと同じ式を使用する。

手法: Chung法（仮想標高フィット）
  実測パワー・速度から物理式を積分して「仮想標高プロファイル」を作り、
  実測標高プロファイルとの誤差が最小になるようCdA・Crrを2変数最適化する。

使い方:
  python calibrate_physics.py <GPXファイルパス> [--mass 78]

必要ライブラリ: numpy, scipy
"""

import argparse
import math
import re
from datetime import datetime

import numpy as np
from scipy.optimize import minimize

G_MS2 = 9.81
RHO_KGM3 = 1.225

STOP_SPEED_MS = 0.3        # これ未満は静止扱い（GPSジッター除去）
RESAMPLE_SEC = 5           # 何秒ごとに集約するか（GPSノイズ低減）
SMOOTH_WINDOW = 3          # 集約後の速度・標高に掛ける移動平均窓（サンプル数）


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


def resample(t_sec, lat, lon, ele, power, bin_sec=RESAMPLE_SEC):
    """bin_sec秒ごとに集約: 区間内の移動距離合計・標高変化・平均パワーを求める。"""
    n = len(t_sec)
    dist_step = np.zeros(n)
    for i in range(1, n):
        dist_step[i] = haversine_m(lat[i - 1], lon[i - 1], lat[i], lon[i])
    cum_dist = np.cumsum(dist_step)

    bins = np.floor(t_sec / bin_sec).astype(int)
    uniq = np.unique(bins)

    out_t, out_dist, out_ele, out_power = [], [], [], []
    for b in uniq:
        idx = np.where(bins == b)[0]
        out_t.append(t_sec[idx].mean())
        out_dist.append(cum_dist[idx[-1]])
        out_ele.append(ele[idx].mean())
        out_power.append(power[idx].mean())

    out_t = np.array(out_t)
    out_dist = np.array(out_dist)
    out_ele = np.array(out_ele)
    out_power = np.array(out_power)

    dt = np.diff(out_t, prepend=out_t[0])
    dt[0] = bin_sec
    dd = np.diff(out_dist, prepend=out_dist[0])
    dd[0] = 0
    speed = dd / dt
    speed[speed < STOP_SPEED_MS] = 0.0

    def movavg(x, w):
        if w <= 1:
            return x
        kernel = np.ones(w) / w
        return np.convolve(x, kernel, mode="same")

    speed_s = movavg(speed, SMOOTH_WINDOW)
    ele_s = movavg(out_ele, SMOOTH_WINDOW)

    return out_t, dt, speed_s, ele_s, out_power


def virtual_elevation(dt, speed, power, mass_kg, cda, crr):
    """物理式を積分して仮想標高プロファイルを作る。"""
    n = len(dt)
    h = np.zeros(n)
    h[0] = 0.0
    for i in range(1, n):
        v = max(0.5 * (speed[i - 1] + speed[i]), 0.1)
        dvdt = (speed[i] - speed[i - 1]) / dt[i] if dt[i] > 0 else 0.0
        p = power[i]
        p_rolling = crr * mass_kg * G_MS2 * v
        p_air = 0.5 * RHO_KGM3 * cda * v ** 3
        dh_dt = (p - p_rolling - p_air - mass_kg * v * dvdt) / (mass_kg * G_MS2)
        h[i] = h[i - 1] + dh_dt * dt[i]
    return h


def fit(dt, speed, ele, power, mass_kg):
    ele0 = ele - ele[0]

    def objective(params):
        cda, crr = params
        if cda <= 0 or crr <= 0:
            return 1e12
        h_virtual = virtual_elevation(dt, speed, power, mass_kg, cda, crr)
        resid = h_virtual - ele0
        return np.sqrt(np.mean(resid ** 2))

    x0 = [0.32, 0.005]
    res = minimize(
        objective, x0, method="Nelder-Mead",
        bounds=[(0.02, 1.50), (0.0005, 0.100)],
        options={"xatol": 1e-6, "fatol": 1e-6, "maxiter": 5000},
    )
    return res


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("gpx_path")
    ap.add_argument("--mass", type=float, default=80.0, help="rider+bike質量[kg]（既定80）")
    args = ap.parse_args()

    t_sec, lat, lon, ele, power = parse_gpx(args.gpx_path)
    print(f"読み込みサンプル数: {len(t_sec)}  総時間: {t_sec[-1]/3600:.2f}h")

    t, dt, speed, ele_s, power_r = resample(t_sec, lat, lon, ele, power)
    print(f"リサンプル後サンプル数: {len(t)}  (bin={RESAMPLE_SEC}s)")
    print(f"移動時間: {np.sum(dt[speed > 0.5]) / 60:.1f} min / 全体 {t[-1]/60:.1f} min")

    res = fit(dt, speed, ele_s, power_r, args.mass)
    cda_fit, crr_fit = res.x
    print()
    print("=== フィット結果 ===")
    print(f"質量(入力値):     {args.mass:.1f} kg")
    print(f"CdA (推定):       {cda_fit:.4f} m²   (アプリ既定値 0.32)")
    print(f"Crr (推定):       {crr_fit:.5f}       (アプリ既定値 0.005)")
    print(f"RMS標高誤差(最適): {res.fun:.2f} m")

    default_rms = np.sqrt(np.mean(
        (virtual_elevation(dt, speed, power_r, args.mass, 0.32, 0.005) - (ele_s - ele_s[0])) ** 2
    ))
    print(f"RMS標高誤差(既定値0.32/0.005): {default_rms:.2f} m")
    print()
    print("※ RMS標高誤差が数十m以上残る場合は、風・気温補正なし／ドライブトレイン損失未考慮")
    print("  ／GPSノイズ等の影響が大きく、推定値の信頼性は限定的です。")


if __name__ == "__main__":
    main()
