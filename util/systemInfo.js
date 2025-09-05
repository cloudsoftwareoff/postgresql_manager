function getSystemInfo() {
  const uptime = process.uptime();
  const memory = process.memoryUsage();
  
  // Format uptime
  const hours = Math.floor(uptime / 3600);
  const minutes = Math.floor((uptime % 3600) / 60);
  const seconds = Math.floor(uptime % 60);
  const uptimeFormatted = `${hours}h ${minutes}m ${seconds}s`;
  
  // Calculate memory usage percentage (approximation)
  const totalMemory = memory.heapTotal;
  const usedMemory = memory.heapUsed;
  const memoryUsage = Math.round((usedMemory / totalMemory) * 100);
  
  // Mock CPU usage (Node.js doesn't have built-in CPU usage)
  // You'd need a library like 'os-utils' for real CPU usage
  const cpuUsage = Math.floor(Math.random() * 20) + 10; // Mock 10-30%
  
  return {
    nodeVersion: process.version,
    platform: process.platform,
    uptime: uptime,
    uptimeFormatted: uptimeFormatted,
    memory: memory,
    memoryUsage: memoryUsage,
    cpuUsage: cpuUsage,
    timestamp: new Date().toISOString(),
    environment: process.env.NODE_ENV || 'development'
  };
}

module.exports = { getSystemInfo };