package com.nirbhay.repo_arc_navigator.controller;

import com.nirbhay.repo_arc_navigator.model.GraphResponse;
import com.nirbhay.repo_arc_navigator.service.GraphService;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.web.bind.annotation.*;

/**
 * REST controller exposing two graph-building strategies:
 *
 *  POST /repo/graph?url={githubUrl}    — Clone a GitHub repo then extract Java AST
 *  POST /repo/local?path={localPath}   — Extract Java AST from an already-local directory
 *
 * Both return the same GraphResponse (nodes + edges + clonedPath) consumed
 * by the Node.js ML Backend gateway.
 */
@RestController
@RequestMapping("/repo")
public class RepoController {

    @Autowired
    private GraphService graphService;

    /** Clone a GitHub repo, parse Java AST, return graph. */
    @PostMapping("/graph")
    public GraphResponse generateGraph(@RequestParam String url) {
        return graphService.buildGraph(url);
    }

    /** Parse Java AST for a repo already on disk, return graph. */
    @PostMapping("/local")
    public GraphResponse generateLocalGraph(@RequestParam String path) {
        return graphService.buildGraphFromLocal(path);
    }

    /** Health ping — used by Node.js /api/status check. */
    @GetMapping("/health")
    public java.util.Map<String, String> health() {
        return java.util.Map.of("status", "ok", "service", "java-ast-backend");
    }
}