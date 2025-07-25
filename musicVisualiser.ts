import { spawn } from "child_process";

// Terminal control utilities for visualization
class TerminalRenderer {
  private width: number;
  private height: number;
  private isInitialized: boolean = false;
  private audioProcess: any = null;

  constructor() {
    this.width = process.stdout.columns || 80;
    this.height = process.stdout.rows || 24;
  }

  setAudioProcess(audioProcess: any): void {
    this.audioProcess = audioProcess;
  }

  init(): void {
    if (this.isInitialized) return;
    process.stdout.write("\x1b[?25l"); // Hide cursor
    process.stdout.write("\x1b[2J\x1b[H"); // Clear screen
    this.isInitialized = true;

    process.on("SIGINT", () => this.cleanup());
    process.on("SIGTERM", () => this.cleanup());
    process.on("exit", () => this.cleanup());
  }

  cleanup(): void {
    if (!this.isInitialized) return;
    if (this.audioProcess && !this.audioProcess.killed) {
      console.log("\n🔇 Stopping audio playback...");
      this.audioProcess.kill("SIGTERM");
    }
    process.stdout.write("\x1b[?25h"); // Restore cursor
    process.stdout.write("\x1b[999;1H\n");
    this.isInitialized = false;
    process.exit(0);
  }

  moveTo(x: number, y: number): void {
    process.stdout.write(`\x1b[${y + 1};${x + 1}H`);
  }

  writeColor(text: string, color?: string): void {
    const colorCodes: { [key: string]: string } = {
      red: "\x1b[31m",
      green: "\x1b[32m",
      yellow: "\x1b[33m",
      blue: "\x1b[34m",
      magenta: "\x1b[35m",
      cyan: "\x1b[36m",
      white: "\x1b[37m",
      reset: "\x1b[0m",
    };
    if (color && colorCodes[color]) {
      process.stdout.write(colorCodes[color] + text + colorCodes.reset);
    } else {
      process.stdout.write(text);
    }
  }

  getDimensions(): { width: number; height: number } {
    const currentWidth = process.stdout.columns || this.width;
    const currentHeight = process.stdout.rows || this.height;
    this.width = currentWidth;
    this.height = currentHeight;
    return {
      width: Math.max(currentWidth, 20),
      height: Math.max(currentHeight, 10),
    };
  }
}
class Complex {
  re: number;
  im: number;
  constructor(re: number, im: number) {
    this.re = re;
    this.im = im;
  }
  static fromAngle(r: number, angle: number) {
    return new Complex(r * Math.cos(angle), r * Math.sin(angle));
  }
  mul(that: Complex): Complex {
    const re = this.re * that.re - this.im * that.im;
    const im = this.re * that.im + this.im * that.re;
    return new Complex(re, im);
  }
  mulScalar(scalar: number): Complex {
    return new Complex(this.re * scalar, this.im * scalar);
  }
  add(that: Complex) {
    return new Complex(this.re + that.re, this.im + that.im);
  }
  sub(that: Complex) {
    return new Complex(this.re - that.re, this.im - that.im);
  }
  getLength() {
    return Math.sqrt(this.re * this.re + this.im * this.im);
  }
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

const FFT = (rawSamples: number[]) => {
  const floatSamples = rawSamples.map((s) => s / 32768);

  const mean =
    floatSamples.reduce((sum, x) => sum + x, 0) / floatSamples.length;
  const zeroCentered = floatSamples.map((x) => x - mean);

  const WindowedArr = applyHannWindow(zeroCentered);

  const newArr = WindowedArr.map((c) => new Complex(c, 0));
  const freqArr = getFreqArrFFT(newArr);

 return freqArr.map((c) => c.getLength());
};

const getFreqArrFFT = (samples: Complex[]): Complex[] => {
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
  const Even = getFreqArrFFT(EvenSamples);
  const Odd = getFreqArrFFT(OddSamples);

  for (let k = 0; k < N / 2; k += 1) {
    const tilda = Complex.fromAngle(1, (-2 * k * Math.PI) / N);
    const oddComponent = Odd[k].mul(tilda);
    freqArrL[k] = Even[k].add(oddComponent);
    freqArrL[k + N / 2] = Even[k].sub(oddComponent);
  }

  return freqArrL;
};

//////////////

const getFreqArrDTF = (samples: Int16Array<ArrayBuffer>): number[] => {
  //get left ear Samples
  console.log("getting left samples");
  const samplesL = [];
  for (let i = 0; i < samples.length; i++) {
    if (i % 2 === 0) samplesL.push(samples[i]);
  }

  console.log("dft");
  //DTF
  const N = samplesL.length;
  const freqArrL: Complex[] = [];
  for (let k = 0; k < N; k++) {
    let freqComponent = new Complex(0, 0);
    for (let n = 0; n < N; n += 1) {
      const angle = Complex.fromAngle(1, (-2 * Math.PI * n * k) / N);
      const term = angle.mulScalar(samplesL[n]);
      freqComponent = freqComponent.add(term);
    }

    freqArrL.push(freqComponent);
  }

  return freqArrL.map((element) => Math.hypot(element.re, element.im));
};

const getSamplesArr = async (): Promise<{
  samples: Int16Array<ArrayBuffer>;
  sampleRate: number;
  duration: number;
}> => {
  // 1) Spawn FFmpeg to emit raw 16-bit PCM to stdout
  return new Promise((resolve, reject) => {
    const SAMPLE_RATE = 48000; // Force consistent sample rate
    const ff = spawn("ffmpeg", [
      "-i",
      "/home/aki/Downloads/Lost.mp3",
      "-f",
      "s16le",
      "-acodec",
      "pcm_s16le",
      "-ar",
      SAMPLE_RATE.toString(), // Force specific sample rate
      "-",
    ]);

    // 2) Buffer the stdout chunks
    const chunks: Buffer[] = [];
    ff.stdout.on("data", (chunk) => chunks.push(chunk));

    ff.stdout.on("end", () => {
      // 3) Concatenate into one Buffer
      const raw = Buffer.concat(chunks);

      // 4) Create a 16-bit view over that buffer
      const samples = new Int16Array(
        raw.buffer,
        raw.byteOffset,
        raw.length / 2,
      );

      // Calculate actual duration
      const duration = samples.length / SAMPLE_RATE; // Duration in seconds

      resolve({ samples, sampleRate: SAMPLE_RATE, duration });
    });

    ff.stderr.on("data", (d) => console.error(d.toString()));
    ff.on("close", (code) => reject("FFmpeg exited" + code));
  });
};

// Helper functions
const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

const startAudioPlayback = (audioFile: string) => {
  const audioProcess = spawn("ffplay", [
    "-i",
    audioFile,
    "-nodisp",
    "-autoexit",
    "-v",
    "quiet",
  ]);
  audioProcess.on("error", (error) =>
    console.error("Audio playback error:", error),
  );
  return audioProcess;
};

// Stereo frequency visualizer using your FFT implementation
async function VisualiseFreqAnimatedStereo(
  freqLeft: number[],
  freqRight: number[],
  renderer: TerminalRenderer,
): Promise<void> {
  const { width, height } = renderer.getDimensions();

  if (width < 20 || height < 10) {
    renderer.moveTo(0, 0);
    renderer.writeColor("Terminal too small!", "red");
    return;
  }

  const titleHeight = 3;
  const scaleWidth = 5;
  const vizWidth = Math.max(width - scaleWidth - 2, 10);
  const vizHeight = Math.max(height - titleHeight - 2, 5);

  // Split screen for left/right channels
  const halfWidth = Math.floor(vizWidth / 2);
  const leftStartX = scaleWidth;
  const rightStartX = scaleWidth + halfWidth;

  // Process frequencies (skip more low frequency noise, only positive frequencies)
  const arrLeft = freqLeft.slice(2000, Math.floor(freqLeft.length / 2));
  const arrRight = freqRight.slice(2000, Math.floor(freqRight.length / 2));

  // Apply gentle power scaling to reduce low frequency dominance
  const logLeft = arrLeft.map((v) => (v > 0 ? Math.pow(v, 0.9) : 0));
  const logRight = arrRight.map((v) => (v > 0 ? Math.pow(v, 0.9) : 0));

  // Normalize
  const maxLeft = Math.max(...logLeft);
  const maxRight = Math.max(...logRight);
  const normalizedLeft =
    maxLeft > 0 ? logLeft.map((v) => v / maxLeft) : logLeft.map(() => 0);
  const normalizedRight =
    maxRight > 0 ? logRight.map((v) => v / maxRight) : logRight.map(() => 0);

  // Calculate bars
  const barWidth = width < 40 ? 1 : width < 80 ? 2 : 3;
  const barSpacing = width < 40 ? 0 : 1;
  const totalBarWidth = barWidth + barSpacing;
  const numPointsPerChannel = Math.max(
    Math.floor(halfWidth / totalBarWidth),
    1,
  );

  // Downsample left channel
  const chunkSizeLeft = normalizedLeft.length / numPointsPerChannel;
  const downsampledLeft: number[] = [];
  for (let i = 0; i < numPointsPerChannel; i++) {
    const start = i * chunkSizeLeft;
    const end = start + chunkSizeLeft;
    const chunk = normalizedLeft.slice(start, end);
    if (chunk.length === 0) continue;
    const peak = chunk.reduce(
      (max, val) => (Math.abs(val) > Math.abs(max) ? val : max),
      0,
    );
    downsampledLeft.push(peak);
  }

  // Downsample right channel
  const chunkSizeRight = normalizedRight.length / numPointsPerChannel;
  const downsampledRight: number[] = [];
  for (let i = 0; i < numPointsPerChannel; i++) {
    const start = i * chunkSizeRight;
    const end = start + chunkSizeRight;
    const chunk = normalizedRight.slice(start, end);
    if (chunk.length === 0) continue;
    const peak = chunk.reduce(
      (max, val) => (Math.abs(val) > Math.abs(max) ? val : max),
      0,
    );
    downsampledRight.push(peak);
  }

  const barChar = barWidth === 1 ? "█" : barWidth === 2 ? "██" : "███";
  const spaceChar = " ".repeat(barSpacing);

  // Draw spectrum bars (mirrored)
  for (let y = 0; y < vizHeight; y++) {
    const threshold = 1 - y / vizHeight;

    // Left channel (from left edge towards center)
    let lineLeft = "";
    for (let x = 0; x < numPointsPerChannel; x++) {
      const value = downsampledLeft[x];
      if (value >= threshold) {
        let color = "white";
        if (x < numPointsPerChannel * 0.3) color = "red";
        else if (x < numPointsPerChannel * 0.6) color = "yellow";
        else color = "green";
        lineLeft += `\x1b[${color === "red" ? "31" : color === "yellow" ? "33" : "32"}m${barChar}\x1b[0m`;
      } else {
        lineLeft += " ".repeat(barWidth);
      }
      if (barSpacing > 0) lineLeft += spaceChar;
    }
    renderer.moveTo(leftStartX, titleHeight + y);
    process.stdout.write("\x1b[K" + lineLeft);

    // Right channel (from right edge towards center - reversed)
    renderer.moveTo(rightStartX, titleHeight + y);
    let lineRight = "";
    for (let x = 0; x < numPointsPerChannel; x++) {
      // Reverse the order so it grows from right edge towards center
      const reversedIndex = numPointsPerChannel - 1 - x;
      const value = downsampledRight[reversedIndex];
      if (value >= threshold) {
        let color = "white";
        if (reversedIndex < numPointsPerChannel * 0.3) color = "red";
        else if (reversedIndex < numPointsPerChannel * 0.6) color = "yellow";
        else color = "green";
        lineRight += `\x1b[${color === "red" ? "31" : color === "yellow" ? "33" : "32"}m${barChar}\x1b[0m`;
      } else {
        lineRight += " ".repeat(barWidth);
      }
      if (barSpacing > 0) lineRight += spaceChar;
    }
    process.stdout.write("\x1b[K" + lineRight);
  }

  // Draw amplitude scale
  const scaleSteps = height < 15 ? 3 : 5;
  for (let i = 0; i <= scaleSteps; i++) {
    const y = titleHeight + Math.floor((vizHeight / scaleSteps) * i);
    const amplitude = (1 - i / scaleSteps).toFixed(1);
    renderer.moveTo(0, y);
    renderer.writeColor(`${amplitude}`, "magenta");
  }
}

// Main visualization function using your FFT implementation
const foo = async (samplesL: number[], samplesR: number[]) => {
  console.log("Starting stereo audio visualizer...");
  const renderer = new TerminalRenderer();
  const audioFile = "/home/aki/Downloads/Lost.mp3";
  let audioProcess: any = null;

  try {
    console.log("Initializing terminal renderer...");
    renderer.init();

    console.log("Starting audio playback and visualization...");
    audioProcess = startAudioPlayback(audioFile);
    console.log("🎵 Audio playback started!");
    renderer.setAudioProcess(audioProcess);

    const TARGET_FPS = 15;
    const FRAME_DURATION = 1000 / TARGET_FPS;
    const chunkSize = 4096;
    const totalChunks = Math.floor(
      Math.min(samplesL.length, samplesR.length) / chunkSize,
    );

    for (let chunk = 0; chunk < totalChunks; chunk++) {
      const startIdx = chunk * chunkSize;
      const endIdx = Math.min(startIdx + chunkSize, samplesL.length);

      const bufLeft = samplesL.slice(startIdx, endIdx);
      const bufRight = samplesR.slice(startIdx, endIdx);

      if (bufLeft.length === 0 || bufRight.length === 0) break;

      // Use YOUR FFT implementation
      const freqArrLeft = FFT(bufLeft);
      const freqArrRight = FFT(bufRight);

      await VisualiseFreqAnimatedStereo(freqArrLeft, freqArrRight, renderer);
      await sleep(FRAME_DURATION);
    }

    console.log("Animation completed!");
  } catch (error) {
    console.error("Error:", error);
  } finally {
    if (audioProcess && !audioProcess.killed) {
      console.log("🔇 Stopping audio playback...");
      audioProcess.kill("SIGTERM");
    }
    renderer.cleanup();
  }
};

const main = () => {
  getSamplesArr().then((buffer) => {
    console.log("getting left samples");
    const samplesL: number[] = [];
    const samplesR: number[] = [];
    for (let i = 0; i < buffer.samples.length / 2; i++) {
      samplesL.push(buffer.samples[i * 2]);
      samplesR.push(buffer.samples[i * 2 + 1]);
    }
    foo(samplesL, samplesR);
  });
};
main();
