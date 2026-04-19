package com.nirbhay.repo_arc_navigator.model;

import java.util.List;

/**
 * Unified graph response returned by both /repo/graph and /repo/local.
 * Consumed directly by the Node.js ML Backend gateway.
 */
public class GraphResponse {

    private List<Node> nodes;
    private List<Edge> edges;
    private String clonedPath;   // Absolute local path where the repo lives on disk

    public GraphResponse(List<Node> nodes, List<Edge> edges, String clonedPath) {
        this.nodes = nodes;
        this.edges = edges;
        this.clonedPath = clonedPath;
    }

    public List<Node> getNodes()    { return nodes; }
    public List<Edge> getEdges()    { return edges; }
    public String getClonedPath()   { return clonedPath; }
}