import { spawn } from "child_process";

interface Hash {
  hashTag: number[];
  time: number;
  song: string;
}

class Complex {
  constructor(
    public re: number,
    public im: number,
  ) {}

  static fromAngle(r: number, angle: number) {
    return new Complex(r * Math.cos(angle), r * Math.sin(angle));
  }

  mul(that: Complex): Complex {
    return new Complex(
      this.re * that.re - this.im * that.im,
      this.re * that.im + this.im * that.re,
    );
  }

  add(that: Complex): Complex {
    return new Complex(this.re + that.re, this.im + that.im);
  }

  sub(that: Complex): Complex {
    return new Complex(this.re - that.re, this.im - that.im);
  }

  scale(factor: number): Complex {
    return new Complex(this.re * factor, this.im * factor);
  }

  getLength(): number {
    return Math.sqrt(this.re * this.re + this.im * this.im);
  }
}

function nextPowerOfTwo(n: number): number {
  return Math.pow(2, Math.ceil(Math.log2(n)));
}

function bluesteinFFT(input: Complex[]): Complex[] {
  const n = input.length;

  // Generate chirp sequence
  const chirp: Complex[] = new Array(n);
  for (let k = 0; k < n; k++) {
    const phase = (-Math.PI * k * k) / n;
    chirp[k] = Complex.fromAngle(1, phase);
  }

  // Pad to next power of 2 for efficient convolution
  const m = nextPowerOfTwo(2 * n - 1);

  // Prepare sequences for convolution
  const A: Complex[] = new Array(m).fill(new Complex(0, 0));
  const B: Complex[] = new Array(m).fill(new Complex(0, 0));

  // Fill sequences
  for (let k = 0; k < n; k++) {
    A[k] = input[k].mul(chirp[k]);
    B[k] = Complex.fromAngle(1, (Math.PI * k * k) / n);
  }
  for (let k = 1; k < n; k++) {
    B[m - k] = new Complex(B[k].re, -B[k].im);
  }

  // Perform convolution using power-of-2 FFT
  const C = convolveFFT(A, B, m);

  // Extract result and apply final chirp
  const result: Complex[] = new Array(n);
  for (let k = 0; k < n; k++) {
    result[k] = C[k].mul(chirp[k]);
  }

  return result;
}

function convolveFFT(A: Complex[], B: Complex[], n: number): Complex[] {
  const fftA = powerOf2FFT(A);
  const fftB = powerOf2FFT(B);

  // Multiply in frequency domain
  const C: Complex[] = new Array(n);
  for (let i = 0; i < n; i++) {
    C[i] = fftA[i].mul(fftB[i]);
  }

  return inverseFFT(C);
}

function powerOf2FFT(samples: Complex[]): Complex[] {
  const N = samples.length;
  if (N <= 1) {
    return [samples[0]];
  }

  const freqArrL: Complex[] = new Array(N);
  const EvenSamples = [];
  const OddSamples = [];

  for (let i = 0; i < N / 2; i++) {
    EvenSamples[i] = samples[i * 2];
    OddSamples[i] = samples[i * 2 + 1];
  }

  const Even = powerOf2FFT(EvenSamples);
  const Odd = powerOf2FFT(OddSamples);

  for (let k = 0; k < N / 2; k += 1) {
    const tilda = Complex.fromAngle(1, (-2 * k * Math.PI) / N);
    const oddComponent = Odd[k].mul(tilda);
    freqArrL[k] = Even[k].add(oddComponent);
    freqArrL[k + N / 2] = Even[k].sub(oddComponent);
  }

  return freqArrL;
}

function inverseFFT(frequencies: Complex[]): Complex[] {
  const n = frequencies.length;

  // Conjugate input
  const conjugated = frequencies.map((f) => new Complex(f.re, -f.im));

  // Forward FFT
  const result = powerOf2FFT(conjugated);

  // Conjugate and scale output
  return result.map((c) => new Complex(c.re / n, -c.im / n));
}

const applyHannWindow = (samples: number[]): number[] => {
  const N = samples.length;
  const windowed = new Array(N);
  for (let n = 0; n < N; n++) {
    const w = 0.5 * (1 - Math.cos((2 * Math.PI * n) / (N - 1))); // Hann
    windowed[n] = samples[n] * w;
  }
  return windowed;
};

const FFT = (rawSamples: number[]): number[] => {
  const complexArr = rawSamples.map((c) => new Complex(c, 0));

  // Use Bluestein's FFT instead of power-of-2 FFT
  const freqArr = bluesteinFFT(complexArr);
  const magnitudes = freqArr.map((c) => c.getLength());

  let slicedArr = Array(magnitudes.length / 2);
  slicedArr = magnitudes.slice(0, Math.floor(magnitudes.length / 2));

  return slicedArr;
};

/**
 * Given an array of samples (3.33 seconds worth) ,
 * compute subFingerprints per 32 overlapping frames (of size 0.37 seconds) .
 *
 * @param samples  number[], sampleRate .
 * @returns number[] of length 256, containing the sub fingerprints for each overlapping frame
 */

const getHash = (samples: number[], sampleRate: number): Hash | 0 => {
  if (samples.length / sampleRate !== 3.33) {
    console.log("needed 3.32375 seconds worth");
    return 0;
  }

  const FFTframes = [];
  const hash: Hash = {
    hashTag: [],
    time: samples.length / sampleRate,
    song: "lost",
  };

  const frameLengthSeconds = 0.37;
  const overlapFactor: number = 31 / 32;
  const hopSizeSeconds = frameLengthSeconds * (1 - overlapFactor);

  const frameLen = Math.floor(frameLengthSeconds * sampleRate);
  const hopSize = Math.floor(hopSizeSeconds * sampleRate);

  const freqPerBin = sampleRate / frameLen;

  //FFT for each frame
  for (let i = 0; i + frameLen <= samples.length; i += hopSize) {
    const frame = samples.slice(i, i + frameLen);
    const windowedFrame = applyHannWindow(frame);
    let freqArr: number[] = Array(frameLen / 2);
    freqArr = FFT(windowedFrame);
    FFTframes.push(freqArr);
  }

  // Step 1: compute bin ranges for each band
  const bandEdges: number[] = [];
  for (let m = 0; m <= 33; m++) {
    const freq = 300 * Math.pow(2000 / 300, m / 33); // 34 edges → 33 bands
    const bin = Math.floor(freq / freqPerBin);
    bandEdges.push(bin);
  }
  const energyInEachFrame: number[][] = [];

  // Step 2: accumulate energy in each band across frames
  FFTframes.forEach((frame) => {
    //compute desired bands 300 hz - 2000 hz
    const energyValues: number[] = new Array(33).fill(0);

    for (let b = 0; b < 33; b++) {
      const startBin = bandEdges[b];
      const endBin = bandEdges[b + 1];

      for (let i = startBin; i < endBin; i++) {
        energyValues[b] += frame[i] * frame[i];
      }
    }
    energyInEachFrame.push(energyValues);
  });

  const fingerPrint = computeAllSubFingerprints(energyInEachFrame);
  hash.hashTag = fingerPrint;

  return hash;
};

/**
 * Compute the 32‑bit sub‑fingerprint for one frame,
 * comparing its 33-band energies to the previous frame.
 *
 * @param prevEnergies  Array of length 33: E(n-1, m)
 * @param currEnergies  Array of length 33: E(n,   m)
 * @returns 32‑bit integer where bit m (0 ≤ m < 32)
 *          is 1 iff [E(n,m) − E(n,m+1)] > [E(n-1,m) − E(n-1,m+1)]
 */
function computeSubFingerprint(
  prevEnergies: number[],
  currEnergies: number[],
): number {
  let hash = 0;
  for (let m = 0; m < 32; m++) {
    const slopePrev = prevEnergies[m] - prevEnergies[m + 1];
    const slopeCurr = currEnergies[m] - currEnergies[m + 1];
    if (slopeCurr > slopePrev) {
      // Set bit m (LSB is bit 0):
      hash |= 1 << m;
    }
  }
  return hash >>> 0; // ensure unsigned 32‑bit
}

/**
 * Given an array of frames’ energies (each a length‑33 number[]),
 * compute one subFingerprint per frame starting at index 1.
 *
 * @param energyFrames  number[][], length F, each entry length 33
 * @returns number[] of length F-1, subFingerprint for frames 1…F-1
 */
function computeAllSubFingerprints(energyFrames: number[][]): number[] {
  const fingerprints: number[] = [];
  for (let n = 1; n < energyFrames.length; n++) {
    const h = computeSubFingerprint(energyFrames[n - 1], energyFrames[n]);
    fingerprints.push(h);
  }
  return fingerprints;
}

const getSamplesArr = async (): Promise<{
  samples: Int16Array;
  sampleRate: number;
  duration: number;
}> => {
  return new Promise((resolve, reject) => {
    const SAMPLE_RATE = 48000;
    const ff = spawn("ffmpeg", [
      "-i",
      "/home/aki/Downloads/Lost.mp3",
      "-f",
      "s16le",
      "-acodec",
      "pcm_s16le",
      "-ar",
      SAMPLE_RATE.toString(),
      "-",
    ]);

    const chunks: Buffer[] = [];
    ff.stdout.on("data", (chunk) => chunks.push(chunk));

    ff.stdout.on("end", () => {
      const raw = Buffer.concat(chunks);
      const samples = new Int16Array(
        raw.buffer,
        raw.byteOffset,
        raw.length / 2,
      );
      const duration = samples.length / SAMPLE_RATE;
      resolve({ samples, sampleRate: SAMPLE_RATE, duration });
    });
    ff.stderr.on("data", (d) => console.error(d.toString()));
    ff.on("close", (code) => {
      if (code !== 0) {
        reject(`FFmpeg exited with code ${code}`);
      }
    });
  });
};

export { getSamplesArr, getHash, FFT };
