package com.example.fixture;

import java.util.ArrayList;
import java.util.List;

/** Subclass with overloads, generics, constructors and a deprecated method */
public class Dog extends Animal implements Comparable<Dog> {

    public Dog() {
    }

    public Dog(String name, double weight) {
        this.name = name;
    }

    public void bark() {
    }

    public void bark(int times) {
    }

    public List<String> getTricks() {
        return new ArrayList<String>();
    }

    public Dog getPuppy() {
        return new Dog();
    }

    @Override
    public int compareTo(Dog other) {
        return 0;
    }

    @Deprecated
    public void oldMethod() {
    }
}
