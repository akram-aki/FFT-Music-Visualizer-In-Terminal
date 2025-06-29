import { spawn } from "child_process";

// Terminal control utilities (similar to what cava uses)
class TerminalRenderer {
  private width: number;
  private height: number;
  private isInitialized: boolean = false;
  private audioProcess: any = null;

  constructor() {
    this.width = process.stdout.columns || 80;
    this.height = process.stdout.rows || 24;
  }

  // Set audio process for cleanup
  setAudioProcess(audioProcess: any): void {
    this.audioProcess = audioProcess;
  }

  // Initialize terminal for animation
  init(): void {
    if (this.isInitialized) return;

    // Hide cursor
    process.stdout.write("\x1b[?25l");

    // Clear screen (simpler approach)
    process.stdout.write("\x1b[2J\x1b[H");

    this.isInitialized = true;

    // Handle cleanup on exit
    process.on("SIGINT", () => this.cleanup());
    process.on("SIGTERM", () => this.cleanup());
    process.on("exit", () => this.cleanup());
  }

  // Clean up terminal state
  cleanup(): void {
    if (!this.isInitialized) return;

    // Stop audio if running
    if (this.audioProcess && !this.audioProcess.killed) {
      console.log("\n🔇 Stopping audio playback...");
      this.audioProcess.kill("SIGTERM");
    }

    // Restore cursor
    process.stdout.write("\x1b[?25h");

    // Move to bottom and clear
    process.stdout.write("\x1b[999;1H\n");

    this.isInitialized = false;
    process.exit(0);
  }

  // Move cursor to specific position (0-indexed)
  moveTo(x: number, y: number): void {
    process.stdout.write(`\x1b[${y + 1};${x + 1}H`);
  }

  // Clear current line
  clearLine(): void {
    process.stdout.write("\x1b[2K");
  }

  // Write text with color
  writeColor(text: string, color?: string): void {
    const colorCodes: { [key: string]: string } = {
      red: "\x1b[31m",
      green: "\x1b[32m",
      yellow: "\x1b[33m",
      blue: "\x1b[34m",
      magenta: "\x1b[35m",
      cyan: "\x1b[36m",
      white: "\x1b[37m",
      bright: "\x1b[1m",
      reset: "\x1b[0m",
    };

    if (color && colorCodes[color]) {
      process.stdout.write(colorCodes[color] + text + colorCodes.reset);
    } else {
      process.stdout.write(text);
    }
  }

  // Get terminal dimensions
  getDimensions(): { width: number; height: number } {
    // Update dimensions dynamically in case terminal was resized
    const currentWidth = process.stdout.columns || this.width;
    const currentHeight = process.stdout.rows || this.height;
    
    // Update stored dimensions
    this.width = currentWidth;
    this.height = currentHeight;
    
    return {
      width: Math.max(currentWidth, 20), // Ensure minimum width
      height: Math.max(currentHeight, 10), // Ensure minimum height
    };
  }
}

class Complex {
  constructor(
    public re: number,
    public im: number = 0,
  ) {}

  static fromPolar(r: number, theta: number): Complex {
    return new Complex(r * Math.cos(theta), r * Math.sin(theta));
  }

  getLength(): number {
    return Math.sqrt(this.re * this.re + this.im * this.im);
  }

  add(other: Complex): Complex {
    return new Complex(this.re + other.re, this.im + other.im);
  }

  subtract(other: Complex): Complex {
    return new Complex(this.re - other.re, this.im - other.im);
  }

  multiply(other: Complex): Complex {
    return new Complex(
      this.re * other.re - this.im * other.im,
      this.re * other.im + this.im * other.re,
    );
  }
}

const getSamples = async (): Promise<{
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
      "-ac",
      "1",
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

function getAudioArr(samples: Int16Array<ArrayBuffer>): number[] {
  // STEP 1: Downsample for terminal plot (100 points max)
  const auioArr: number[] = [];
  for (let j = 0; j < samples.length; j += 1600) {
    const workingSamples = samples.slice(j, j + 1600);
    const numPoints = 100;
    const chunkSize = Math.floor(workingSamples.length / numPoints);
    const downsampled: number[] = [];

    for (let i = 0; i < numPoints; i++) {
      const start = i * chunkSize;
      const end = start + chunkSize;
      const chunk = workingSamples.slice(start, end);

      if (chunk.length === 0) continue;

      // Use peak amplitude for each chunk
      const peak = chunk.reduce(
        (currentMax, element) =>
          Math.abs(element) > Math.abs(currentMax) ? element : currentMax,
        0,
      );
      downsampled.push(peak);
    }

    auioArr.push(...downsampled);
  }
  return auioArr;
}

/**
 * Perform an in-place radix-2 Cooley–Tukey FFT.
 *
 * @param input  an array of Complex values; length must be a power of two.
 * @returns      a new array of Complex of the same length containing the DFT.
 */
function FFT(input: Complex[]): Complex[] {
  const N = input.length;
  if (N <= 1) return [new Complex(input[0].re, input[0].im)];

  // split inputs
  const even: Complex[] = new Array(N / 2);
  const odd: Complex[] = new Array(N / 2);
  for (let i = 0; i < N / 2; i++) {
    even[i] = input[2 * i];
    odd[i] = input[2 * i + 1];
  }

  const Feven = FFT(even);
  const Fodd = FFT(odd);

  // combine
  const combined: Complex[] = new Array(N);
  for (let k = 0; k < N / 2; k++) {
    // twiddle factor e^(−2πi k / N)
    const tw = Complex.fromPolar(1, (-2 * Math.PI * k) / N);
    const t = tw.multiply(Fodd[k]);
    combined[k] = Feven[k].add(t);
    combined[k + N / 2] = Feven[k].subtract(t);
  }

  return combined;
}

// Helper function to pad array to next power of 2
function padToPowerOfTwo(
  samples: Int16Array<ArrayBuffer> | number[],
): number[] {
  const N = samples.length;
  const nextPowerOfTwo = Math.pow(2, Math.ceil(Math.log2(N)));
  const padded = [...samples];
  while (padded.length < nextPowerOfTwo) {
    padded.push(0);
  }
  return padded;
}

// If you really want to start from real samples:
function realFFT(samples: Int16Array<ArrayBuffer> | number[]): Complex[] {
  const paddedSamples = padToPowerOfTwo(samples);
  const complexInput = paddedSamples.map((v) => new Complex(v, 0));
  return FFT(complexInput);
}

async function visualizeAudio(samples: Int16Array<ArrayBuffer>): Promise<void> {
  // STEP 1: Downsample for terminal plot (100 points max)
  for (let j = 0; j < samples.length; j += 48000) {
    const workingSamples = samples.slice(j, j + 48000);
    const numPoints = 100;
    const chunkSize = Math.floor(workingSamples.length / numPoints);
    const downsampled: number[] = [];

    for (let i = 0; i < numPoints; i++) {
      const start = i * chunkSize;
      const end = start + chunkSize;
      const chunk = workingSamples.slice(start, end);

      if (chunk.length === 0) continue;

      // Use peak amplitude for each chunk
      const peak = chunk.reduce(
        (currentMax, element) =>
          Math.abs(element) > Math.abs(currentMax) ? element : currentMax,
        0,
      );
      downsampled.push(peak);
    }

    // STEP 2: Normalize to 0-1 range
    const max = Math.max(...downsampled);
    const normalized = max > 0 ? downsampled.map((v) => v / max) : downsampled;

    // STEP 3: Apply compression for better visualization
    //const compressed = normalized.map((v) => Math.pow(v, 0.7));

    // STEP 4: Draw the chart
    const HEIGHT = 30;
    console.log("\nAudio Waveform Visualization:\n");

    // Print from top to bottom (HEIGHT=20 down to 0)
    for (let level = HEIGHT; level >= 0; level--) {
      const threshold = level / HEIGHT; // 0.0 to 1.0

      const line = normalized
        .map((value) => {
          if (value >= threshold) {
            // Choose character based on intensity
            return "▊"; // 7/8 block
          }
          return " "; // Empty space
        })
        .join("");

      // Add scale labels
      const label =
        level === HEIGHT
          ? "1.0 |"
          : level === 0
            ? "0.0 |"
            : level === Math.floor(HEIGHT / 2)
              ? "0.5 |"
              : "    |";
      console.log(`${label}${line}`);
    }

    // Add bottom axis
    console.log("    " + "+".repeat(numPoints));
    console.log(`    0${" ".repeat(45)}Time${" ".repeat(45)}End`);
    await sleep(100);
    console.clear();
  }
}
const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

// Function to start audio playback
const startAudioPlayback = (audioFile: string) => {
  const audioProcess = spawn("ffplay", [
    "-i",
    audioFile,
    "-nodisp", // No video display
    "-autoexit", // Exit when playback ends
    "-v",
    "quiet", // Quiet output
  ]);

  // Handle audio process errors
  audioProcess.on("error", (error) => {
    console.error("Audio playback error:", error);
  });

  audioProcess.stderr.on("data", (data) => {
    // Only log significant errors, ignore routine ffplay output
    const errorMsg = data.toString();
    if (errorMsg.includes("Error") || errorMsg.includes("Failed")) {
      console.error("Audio error:", errorMsg);
    }
  });

  return audioProcess;
};

// Enhanced frequency visualizer with robust terminal control
async function VisualiseFreqAnimated(
  freq: Complex[],
  renderer: TerminalRenderer,
  sampleRate: number = 48000,
): Promise<void> {
  const { width, height } = renderer.getDimensions();

  // Add minimum size checks
  if (width < 20 || height < 10) {
    renderer.moveTo(0, 0);
    renderer.writeColor("Terminal too small!", "red");
    return;
  }

  // Calculate visualization area dynamically based on terminal size
  const titleHeight = 3; // Space for title and labels
  const scaleWidth = 5; // Space for amplitude scale on left
  const vizWidth = Math.max(width - scaleWidth - 2, 10); // At least 10 chars for viz
  const vizHeight = Math.max(height - titleHeight - 2, 5); // At least 5 lines for viz

  const arr = freq.slice(0, Math.floor(freq.length / 2)); // Only positive frequencies
  const max = Math.max(...arr.map((f) => f.getLength()));
  const normalized =
    max > 0 ? arr.map((f) => f.getLength() / max) : arr.map(() => 0);

  // Dynamically calculate bars based on terminal width
  // For small terminals, use single chars; for larger ones, use wider bars
  const barWidth = width < 40 ? 1 : width < 80 ? 2 : 3;
  const barSpacing = width < 40 ? 0 : 1; // No spacing on very small terminals
  const totalBarWidth = barWidth + barSpacing;
  const numPoints = Math.max(Math.floor(vizWidth / totalBarWidth), 1);

  // Downsample to fit calculated number of points
  const chunkSize = normalized.length / numPoints;
  const downsampled: number[] = [];

  for (let i = 0; i < numPoints; i++) {
    const start = i * chunkSize;
    const end = start + chunkSize;
    const chunk = normalized.slice(start, end);

    if (chunk.length === 0) continue;

    // Use peak amplitude for each chunk
    const peak = chunk.reduce(
      (currentMax, element) =>
        Math.abs(element) > Math.abs(currentMax) ? element : currentMax,
      0,
    );
    downsampled.push(peak);
  }

  // Clear screen and draw title

  // Draw frequency labels - simplified for small terminals
  renderer.moveTo(0, 1);
  const nyquistFreq = sampleRate / 2;
  // No frequency labels for very small terminals

  // Choose bar character based on terminal width
  const barChar = barWidth === 1 ? "█" : barWidth === 2 ? "██" : "███";
  const spaceChar = " ".repeat(barSpacing);

  // Draw the spectrum bars (bottom to top)
  for (let y = 0; y < vizHeight; y++) {
    renderer.moveTo(scaleWidth, titleHeight + y);

    const threshold = 1 - y / vizHeight; // Invert so bars grow upward
    let line = "";

    for (let x = 0; x < numPoints; x++) {
      const value = downsampled[x];

      if (value >= threshold) {
        // Color based on frequency (like cava)
        let color = "white";
        if (x < numPoints * 0.3) color = "red"; // Bass
        else if (x < numPoints * 0.6) color = "yellow"; // Mids
        else color = "green"; // Highs

        line += `\x1b[${color === "red" ? "31" : color === "yellow" ? "33" : "32"}m${barChar}\x1b[0m`;
      } else {
        line += " ".repeat(barWidth); // Match the width of the bar with spaces
      }

      // Add spacing between bars
      if (barSpacing > 0) line += spaceChar;
    }

    // Clear from cursor position to end of line, then write
    process.stdout.write("\x1b[K" + line);
  }

  // Draw amplitude scale - simplified for small terminals
  const scaleSteps = height < 15 ? 3 : 5; // Fewer scale markers on small terminals
  for (let i = 0; i <= scaleSteps; i++) {
    const y = titleHeight + Math.floor((vizHeight / scaleSteps) * i);
    const amplitude = (1 - i / scaleSteps).toFixed(1);
    renderer.moveTo(0, y);
    renderer.writeColor(`${amplitude}`, "magenta");
  }

  // Draw bottom border - only if there's enough space
  if (height > 15) {
    renderer.moveTo(scaleWidth, titleHeight + vizHeight);
    renderer.writeColor("─".repeat(Math.min(numPoints * totalBarWidth, vizWidth)), "blue");
  }
}

// Main animation loop with robust terminal control
const runAnimated = async () => {
  console.log("Starting audio visualizer...");
  const renderer = new TerminalRenderer();
  const audioFile = "/home/aki/Downloads/Lost.mp3";
  let audioProcess: any = null;

  try {
    console.log("Loading audio samples...");
    const { samples, sampleRate, duration } = await getSamples();
    console.log(
      `Loaded ${samples.length} samples, sample rate: ${sampleRate} Hz, duration: ${duration.toFixed(2)} `,
    );

    const arr = getAudioArr(samples);
    console.log(`Processed ${arr.length} audio data points`);

    console.log("Initializing terminal renderer...");
    renderer.init();

    console.log("Starting audio playback and visualization...");

    // Start audio playback
    audioProcess = startAudioPlayback(audioFile);
    console.log("🎵 Audio playback started!");

    // Set audio process in renderer for cleanup
    renderer.setAudioProcess(audioProcess);

    // Animation loop at 15 FPS
    const start = performance.now();

    const TARGET_FPS = 15;
    const FRAME_DURATION = 1000 / TARGET_FPS; // 67ms per frame
    const totalFrames = Math.floor(duration * TARGET_FPS); // Total frames needed
    const chunkSize = Math.ceil(arr.length / totalFrames); // Samples per frame


    for (let frame = 0; frame < totalFrames; frame++) {
      const startIdx = frame * chunkSize;
      const endIdx = Math.min(startIdx + chunkSize, arr.length);
      const buf = arr.slice(startIdx, endIdx);

      if (buf.length === 0) break; // No more data

      const freqArr = realFFT(buf);
      await VisualiseFreqAnimated(freqArr, renderer, sampleRate);

      // Fixed 15 FPS timing
      await sleep(FRAME_DURATION);
    }
    console.log("Animation completed!");

    const end = performance.now();
    const actualElapsed = end - start;
    const expectedDuration = duration * 1000; // Convert to milliseconds
    const actualFPS = totalFrames / (actualElapsed / 1000);

    console.log(
      `Actual elapsed time: ${actualElapsed.toFixed(2)} ms (${(actualElapsed / 1000).toFixed(2)}s)`,
    );
    console.log(
      `Expected duration: ${expectedDuration.toFixed(2)} ms (${duration.toFixed(2)}s)`,
    );
    console.log(
      `Timing accuracy: ${((actualElapsed / expectedDuration) * 100).toFixed(1)}%`,
    );
    console.log(
      `Target FPS: ${TARGET_FPS}, Actual FPS: ${actualFPS.toFixed(2)}`,
    );
  } catch (error) {
    console.error("Error:", error);
    if (error instanceof Error) {
      console.error("Stack:", error.stack);
    }
  } finally {
    // Clean up audio process
    if (audioProcess && !audioProcess.killed) {
      console.log("🔇 Stopping audio playback...");
      audioProcess.kill("SIGTERM");
    }

    renderer.cleanup();
  }
};

// Use the animated version

runAnimated();
