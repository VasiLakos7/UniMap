declare module 'dijkstrajs' {
    /**
     * Finds the shortest path between two nodes in a graph using Dijkstra's algorithm.
     * @param graph The graph data structure (adjacency list with weights).
     * @param startNodeId The ID of the starting node.
     * @param endNodeId The ID of the destination node.
     * @returns An array of node IDs representing the shortest path.
     */
    export function find_path(graph: any, startNodeId: string, endNodeId: string): string[];
}