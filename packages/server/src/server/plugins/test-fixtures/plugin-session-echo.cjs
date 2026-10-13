process.on("message", (message) => {
  if (message?.type !== "clisbot_frame") return;
  process.send?.(message);
});
