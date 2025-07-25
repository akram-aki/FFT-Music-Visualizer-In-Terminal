#include <fftw3.h>
#include <math.h>
#include <mpg123.h>
#include <stddef.h>
#include <stdio.h>
#include <stdlib.h>
#include <string.h>
#include <time.h>

typedef struct {
  short *samples;
  size_t num_samples;
  long sample_rate;
  int channels;
} AudioData;

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

  struct timespec t_start, t_end;
  double elapsed;

  AudioData audio_data;

  if (extract_mp3_samples(argv[1], &audio_data) != 0) {
    fprintf(stderr, "Failed to extract samples\n");
    return 1;
  }

  printf("Successfully extracted %zu samples\n", audio_data.num_samples);
  printf("Duration: %.2f seconds\n", (double)audio_data.num_samples /
                                         audio_data.channels /
                                         audio_data.sample_rate);

  // get left channel samples
  double *leftChanelSamples =
      malloc(audio_data.num_samples / 2 * sizeof(double));

  if (leftChanelSamples == NULL) {
    fprintf(stderr,
            "Error: Failed to allocate memory for leftChannelSamples.\n");
    exit(EXIT_FAILURE);
  }

  for (int i = 0; i < audio_data.num_samples / 2; i++) {
    leftChanelSamples[i] = audio_data.samples[i * 2];
  }

  // fft every hop ~3.33s

  int hopsize = 159840;

  if (clock_gettime(CLOCK_MONOTONIC, &t_start) != 0) {
    perror("clock_gettime");
    exit(EXIT_FAILURE);
  }

  double *in = malloc(hopsize * sizeof(double));

  if (in == NULL) {
    fprintf(stderr, "Error: Failed to allocate memory for in.\n");
    exit(EXIT_FAILURE);
  }

  double *freqArr = alloc(audio_data.num_samples / 2 * sizeof(double));

  if (freqArr == NULL) {
    fprintf(stderr, "Error: Failed to allocate memory for freqArr.\n");
    exit(EXIT_FAILURE);
  }

  fftw_complex *out = fftw_malloc(sizeof(fftw_complex) * (hopsize / 2 + 1));

  if (out == NULL) {
    fprintf(stderr, "Error: Failed to allocate memory for out.\n");
    exit(EXIT_FAILURE);
  }

  fftw_plan plan = fftw_plan_dft_r2c_1d(hopsize, in, out, FFTW_MEASURE);

  if (!plan) {
    fprintf(stderr, "Error: FFTW plan creation failed\n");
    exit(EXIT_FAILURE);
  }

  for (int i = 0; i + hopsize <= audio_data.num_samples / 2; i += hopsize) {
    for (int j = 0; j < hopsize; j++) {
      in[j] = leftChanelSamples[i + j];
    }

    fftw_execute(plan);

    for (int j = 0; j < hopsize / 2 + 1; j++) {
      freqArr[i + j] = sqrt(out[j][0] * out[j][0] + out[j][1] * out[j][1]);
    }
  }

  if (clock_gettime(CLOCK_MONOTONIC, &t_end) != 0) {
    perror("clock_gettime");
    exit(EXIT_FAILURE);
  }

  // Compute elapsed time in seconds
  elapsed =
      (t_end.tv_sec - t_start.tv_sec) + (t_end.tv_nsec - t_start.tv_nsec) / 1e9;

  printf("Processing loop took %.6f seconds\n", elapsed);

  // Clean up
  free(audio_data.samples);
  free(leftChanelSamples);
  free(freqArr);
  fftw_destroy_plan(plan);
  free(in);
  fftw_free(out);

  return 0;
}
