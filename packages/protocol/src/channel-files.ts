/** The largest inbound channel attachment the Hub writes to a Host
 * (`channel.file.write.request`). A larger one reaches the Agent as a notice
 * naming this limit, not as a file. */
export const CHANNEL_FILE_WRITE_MAX_BYTES = 100 * 1024 * 1024;

/** The most bytes one `channel.file.write.request` carries. */
export const CHANNEL_FILE_WRITE_CHUNK_BYTES = 512 * 1024;
