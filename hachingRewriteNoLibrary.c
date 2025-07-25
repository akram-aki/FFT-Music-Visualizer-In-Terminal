#include <complex.h>
#include <math.h>
#include <mpg123.h>
#include <stddef.h>
#include <stdio.h>
#include <stdlib.h>
#include <string.h>

#ifndef PI
#define PI 3.1415926535
#endif
// Structure to hold audio data
typedef struct {
  short *samples;
  size_t num_samples;
  long sample_rate;
  int channels;
} AudioData;

typedef struct {
  double re;
  double im;
} Complex;

Complex add(Complex a, Complex b) {
  return (Complex){a.re + b.re, a.im + b.im};
}

Complex sub(Complex a, Complex b) {
  return (Complex){a.re - b.re, a.im - b.im};
}
Complex mul(Complex a, Complex b) {
  return (Complex){a.re * b.re - a.im * b.im, a.re * b.im + a.im * b.re};
}

double getLength(Complex a) { return sqrt(a.re * a.re + a.im * a.im); }

Complex fromAngle(float amplitude, float angle) {
  return (Complex){amplitude * cos(angle), amplitude * sin(angle)};
}

double nextPowerOfTwo(int n) { return pow(2, ceil(log2(n))); }

Complex *bluesteinFFT(Complex *buff, size_t bufflen) {
  Complex *result = malloc(bufflen * sizeof(Complex));

  // chirp sequence
  Complex *chirp = malloc(bufflen * sizeof(Complex));

  for (int k = 0; k < bufflen; k++) {
    float phase = (-PI * k * k) / bufflen;
    chirp[k] = fromAngle(1, phase);
  }
  int m = nextPowerOfTwo(bufflen * 2 - 1);

  // prepare sequences for convolution
  Complex *A = malloc(m * sizeof(Complex));
  Complex *B = malloc(m * sizeof(Complex));
  memset(A, 0, m * sizeof(Complex));
  memset(B, 0, m * sizeof(Complex));

  // fill sequences
  for (int k = 0; k < bufflen; k++) {
    A[k] = mul(buff[k], chirp[k]);
    B[k] = fromAngle(1, (PI * k * k) / bufflen);
  }
  for (int k = 1; k < bufflen; k++) {
    B[m - k] = (Complex){B[k].re, -B[k].im};
  }
}

int extract_mp3_samples(const char *filename, AudioData *audio_data) {
  mpg123_handle *mh;
  unsigned char *buffer;
  size_t buffer_size;
  size_t done;
  int err;

  int channels, encoding;
  long rate;

  // Initialize mpg123
  if (mpg123_init() != MPG123_OK) {
    fprintf(stderr, "Failed to initialize mpg123\n");
    return -1;
  }

  // Create mpg123 handle
  mh = mpg123_new(NULL, &err);
  if (mh == NULL) {
    fprintf(stderr, "Unable to create mpg123 handle: %s\n",
            mpg123_plain_strerror(err));
    mpg123_exit();
    return -1;
  }

  // Open the file
  if (mpg123_open(mh, filename) != MPG123_OK) {
    fprintf(stderr, "Unable to open file: %s\n", mpg123_strerror(mh));
    mpg123_delete(mh);
    mpg123_exit();
    return -1;
  }

  // Get format information
  if (mpg123_getformat(mh, &rate, &channels, &encoding) != MPG123_OK) {
    fprintf(stderr, "Unable to get format information\n");
    mpg123_close(mh);
    mpg123_delete(mh);
    mpg123_exit();
    return -1;
  }

  // Ensure we're working with 16-bit signed integers
  mpg123_format_none(mh);
  mpg123_format(mh, rate, channels, MPG123_ENC_SIGNED_16);

  // Set up buffer
  buffer_size = mpg123_outblock(mh);
  buffer = malloc(buffer_size);
  if (buffer == NULL) {
    fprintf(stderr, "Unable to allocate buffer\n");
    mpg123_close(mh);
    mpg123_delete(mh);
    mpg123_exit();
    return -1;
  }

  // Initialize audio data structure
  audio_data->sample_rate = rate;
  audio_data->channels = channels;
  audio_data->num_samples = 0;
  audio_data->samples = NULL;

  printf("Sample rate: %ld Hz\n", rate);
  printf("Channels: %d\n", channels);

  // Read and decode the entire file
  size_t total_samples = 0;
  size_t capacity = rate * channels * 2; // Initial capacity for ~2 seconds
  audio_data->samples = malloc(capacity * sizeof(short));

  if (audio_data->samples == NULL) {
    fprintf(stderr, "Unable to allocate sample buffer\n");
    free(buffer);
    mpg123_close(mh);
    mpg123_delete(mh);
    mpg123_exit();
    return -1;
  }

  while (mpg123_read(mh, buffer, buffer_size, &done) == MPG123_OK) {
    size_t samples_in_buffer = done / sizeof(short);

    // Resize buffer if needed
    if (total_samples + samples_in_buffer > capacity) {
      capacity *= 2;
      audio_data->samples =
          realloc(audio_data->samples, capacity * sizeof(short));
      if (audio_data->samples == NULL) {
        fprintf(stderr, "Unable to reallocate sample buffer\n");
        free(buffer);
        mpg123_close(mh);
        mpg123_delete(mh);
        mpg123_exit();
        return -1;
      }
    }

    // Copy samples to our array
    short *samples = (short *)buffer;
    for (size_t i = 0; i < samples_in_buffer; i++) {
      audio_data->samples[total_samples + i] = samples[i];
    }

    total_samples += samples_in_buffer;
  }

  audio_data->num_samples = total_samples;

  // Clean up
  free(buffer);
  mpg123_close(mh);
  mpg123_delete(mh);
  mpg123_exit();

  return 0;
}

int main(int argc, char *argv[]) {
  if (argc != 2) {
    printf("Usage: %s <mp3_file>\n", argv[0]);
    return 1;
  }

  AudioData audio_data;

  if (extract_mp3_samples(argv[1], &audio_data) != 0) {
    fprintf(stderr, "Failed to extract samples\n");
    return 1;
  }

  printf("Successfully extracted %zu samples\n", audio_data.num_samples);
  printf("Duration: %.2f seconds\n", (double)audio_data.num_samples /
                                         audio_data.channels /
                                         audio_data.sample_rate);

  // Clean up
  free(audio_data.samples);

  return 0;
}
