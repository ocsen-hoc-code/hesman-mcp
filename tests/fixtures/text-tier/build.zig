const std = @import("std");

pub fn build(b: *std.Build) void {
    const exe = b.addExecutable(.{ .name = "telemetry-agent" });
    b.installArtifact(exe);
}
