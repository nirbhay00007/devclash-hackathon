package com.nirbhay.repo_arc_navigator.controller;

import com.nirbhay.repo_arc_navigator.model.GraphResponse;
import com.nirbhay.repo_arc_navigator.service.GraphService;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.web.bind.annotation.PostMapping;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RequestParam;
import org.springframework.web.bind.annotation.RestController;

@RestController
@RequestMapping("/repo")
public class RepoController {

    @Autowired
    private GraphService graphService;


    @PostMapping("/graph")
    public GraphResponse generateGraph(@RequestParam String url) {
        return graphService.buildGraph(url);
    }
}