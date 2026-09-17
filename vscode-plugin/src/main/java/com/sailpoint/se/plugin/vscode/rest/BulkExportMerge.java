package com.sailpoint.se.plugin.vscode.rest;

import java.lang.reflect.Constructor;
import java.util.ArrayList;
import java.util.HashMap;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;

import sailpoint.object.Attributes;
import sailpoint.object.AuditConfig;
import sailpoint.object.Configuration;
import sailpoint.object.Dictionary;
import sailpoint.object.DictionaryTerm;
import sailpoint.object.ObjectAttribute;
import sailpoint.object.ObjectConfig;
import sailpoint.object.SailPointObject;
import sailpoint.object.UIConfig;
import sailpoint.tools.GeneralException;
import sailpoint.tools.xml.AbstractXmlObject;
import sailpoint.tools.xml.XMLObjectFactory;

/** Produces the same additive SSB merge documents as V2Plugin Object Exporter. */
final class BulkExportMerge {

    private BulkExportMerge() { }

    static String merge(SailPointObject current, SailPointObject baseline) throws GeneralException {
        if (!current.getClass().equals(baseline.getClass()) || !supported(current)) {
            throw new GeneralException("Merge export is not supported for " + current.getClass().getSimpleName());
        }
        SailPointObject delta = instantiate(current.getClass());
        delta.setName(current.getName());

        if (current instanceof Configuration || current instanceof UIConfig) {
            Configuration currentConfig = (Configuration) current;
            Configuration baselineConfig = (Configuration) baseline;
            ((Configuration) delta).setAttributes(diffAttributes(
                    baselineConfig.getAttributes(), currentConfig.getAttributes()));
        } else if (current instanceof ObjectConfig) {
            ObjectConfig currentConfig = (ObjectConfig) current;
            ObjectConfig baselineConfig = (ObjectConfig) baseline;
            ((ObjectConfig) delta).setConfigAttributes(diffAttributes(
                    baselineConfig.getConfigAttributes(), currentConfig.getConfigAttributes()));
            ((ObjectConfig) delta).setObjectAttributes(diffNamed(
                    baselineConfig.getObjectAttributes(), currentConfig.getObjectAttributes()));
        } else if (current instanceof AuditConfig) {
            AuditConfig currentConfig = (AuditConfig) current;
            AuditConfig baselineConfig = (AuditConfig) baseline;
            ((AuditConfig) delta).setAttributes(diffNamed(
                    baselineConfig.getAttributes(), currentConfig.getAttributes()));
            ((AuditConfig) delta).setClasses(diffNamed(
                    baselineConfig.getClasses(), currentConfig.getClasses()));
            ((AuditConfig) delta).setActions(diffNamed(
                    baselineConfig.getActions(), currentConfig.getActions()));
        } else if (current instanceof Dictionary) {
            Dictionary currentDictionary = (Dictionary) current;
            Dictionary baselineDictionary = (Dictionary) baseline;
            List<DictionaryTerm> terms = new ArrayList<>();
            List<String> oldValues = new ArrayList<>();
            if (baselineDictionary.getTerms() != null) {
                for (DictionaryTerm term : baselineDictionary.getTerms()) {
                    oldValues.add(term.getValue());
                }
            }
            if (currentDictionary.getTerms() != null) {
                for (DictionaryTerm term : currentDictionary.getTerms()) {
                    if (!oldValues.contains(term.getValue())) {
                        terms.add(term);
                    }
                }
            }
            ((Dictionary) delta).setTerms(terms);
        }

        String xml = XMLObjectFactory.getInstance().toXml(delta, true);
        String simpleName = current.getClass().getSimpleName();
        xml = xml.replace("<!DOCTYPE " + simpleName, "<!DOCTYPE sailpoint");
        int doctypeEnd = xml.indexOf('>', xml.indexOf("<!DOCTYPE"));
        if (doctypeEnd >= 0) {
            xml = xml.substring(0, doctypeEnd + 1)
                    + "\n<sailpoint>\n<ImportAction name=\"merge\">\n"
                    + xml.substring(doctypeEnd + 1).trim()
                    + "\n</ImportAction>\n</sailpoint>\n";
        }
        return xml;
    }

    private static boolean supported(SailPointObject object) {
        return object instanceof Configuration || object instanceof UIConfig
                || object instanceof ObjectConfig || object instanceof AuditConfig
                || object instanceof Dictionary;
    }

    private static SailPointObject instantiate(Class<?> type) throws GeneralException {
        try {
            Constructor<?> constructor = type.getDeclaredConstructor();
            constructor.setAccessible(true);
            return (SailPointObject) constructor.newInstance();
        } catch (ReflectiveOperationException e) {
            throw new GeneralException("Could not create merge object", e);
        }
    }

    private static Attributes<String, Object> diffAttributes(
            Attributes<String, Object> baseline, Attributes<String, Object> current) throws GeneralException {
        Attributes<String, Object> result = new Attributes<>();
        if (current == null) {
            return result;
        }
        for (Map.Entry<String, Object> entry : current.entrySet()) {
            Object oldValue = baseline == null ? null : baseline.get(entry.getKey());
            Object difference = difference(oldValue, entry.getValue());
            if (difference != null) {
                result.put(entry.getKey(), difference);
            }
        }
        return result;
    }

    @SuppressWarnings("unchecked")
    private static Object difference(Object oldValue, Object newValue) throws GeneralException {
        if (oldValue == null) {
            return newValue;
        }
        if (newValue instanceof Map && oldValue instanceof Map) {
            Map<String, Object> result = new LinkedHashMap<>();
            for (Map.Entry<String, Object> entry : ((Map<String, Object>) newValue).entrySet()) {
                Object nested = difference(((Map<String, Object>) oldValue).get(entry.getKey()), entry.getValue());
                if (nested != null) {
                    result.put(entry.getKey(), nested);
                }
            }
            return result.isEmpty() ? null : result;
        }
        if (newValue instanceof List && oldValue instanceof List) {
            List<Object> result = new ArrayList<>();
            List<String> oldSerialized = serialize((List<Object>) oldValue);
            for (Object item : (List<Object>) newValue) {
                if (!oldSerialized.contains(serialized(item))) {
                    result.add(item);
                }
            }
            return result.isEmpty() ? null : result;
        }
        return equal(oldValue, newValue) ? null : newValue;
    }

    private static <T> List<T> diffNamed(List<T> baseline, List<T> current) throws GeneralException {
        List<T> result = new ArrayList<>();
        Map<String, T> oldByName = new HashMap<>();
        if (baseline != null) {
            for (T item : baseline) {
                oldByName.put(name(item), item);
            }
        }
        if (current != null) {
            for (T item : current) {
                T old = oldByName.get(name(item));
                if (old == null || !equal(old, item)) {
                    result.add(item);
                }
            }
        }
        return result;
    }

    private static String name(Object value) {
        try {
            return String.valueOf(value.getClass().getMethod("getName").invoke(value));
        } catch (ReflectiveOperationException e) {
            return serialized(value);
        }
    }

    private static boolean equal(Object left, Object right) throws GeneralException {
        return serialized(left).equals(serialized(right));
    }

    private static List<String> serialize(List<Object> values) {
        List<String> result = new ArrayList<>();
        for (Object value : values) {
            result.add(serialized(value));
        }
        return result;
    }

    private static String serialized(Object value) {
        if (value instanceof AbstractXmlObject) {
            try {
                return ((AbstractXmlObject) value).toXml();
            } catch (GeneralException e) {
                return String.valueOf(value);
            }
        }
        return String.valueOf(value);
    }
}
