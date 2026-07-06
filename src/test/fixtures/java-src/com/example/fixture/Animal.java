package com.example.fixture;

/** Base class of the test hierarchy */
public class Animal {

    public static final String KINGDOM = "Animalia";

    protected String name;
    public int age;

    public String getName() {
        return name;
    }

    public void setName(String name) {
        this.name = name;
    }

    public static int count() {
        return 0;
    }

    protected void internalOnly() {
    }
}
