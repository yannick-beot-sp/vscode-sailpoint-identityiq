import java.lang.reflect.Constructor;
import java.lang.reflect.Field;
import java.lang.reflect.Method;
import java.lang.reflect.Modifier;
import java.lang.reflect.Parameter;
import java.lang.reflect.Type;
import java.net.URI;
import java.nio.file.FileSystem;
import java.nio.file.FileSystems;
import java.nio.file.Files;
import java.nio.file.Path;
import java.util.ArrayList;
import java.util.List;
import java.util.Map;
import java.util.TreeSet;
import java.util.stream.Collectors;
import java.util.stream.Stream;

/**
 * Generates resources/jdk-core-index.json: the metadata of the JDK classes
 * commonly used in IdentityIQ BeanShell rules, in the JavaClassInfo shape of
 * src/beanshell/java/model.ts.
 *
 * Dev-time tool, never shipped nor run on user machines. Regenerate with:
 *
 *   java scripts/GenerateJdkIndex.java > resources/jdk-core-index.json
 *
 * Requires JDK 11+ (walks the jrt: filesystem of the running JDK).
 */
public class GenerateJdkIndex {

    /** module → packages to index */
    private static final Map<String, List<String>> PACKAGES = Map.of(
            "java.base", List.of(
                    "java.lang", "java.lang.reflect",
                    "java.util", "java.util.regex", "java.util.function",
                    "java.util.stream", "java.util.concurrent",
                    "java.io", "java.net",
                    "java.text", "java.time", "java.time.format",
                    "java.math", "java.security"),
            "java.sql", List.of("java.sql"));

    public static void main(String[] args) throws Exception {
        TreeSet<String> classNames = new TreeSet<>();
        FileSystem jrt = FileSystems.getFileSystem(URI.create("jrt:/"));
        for (Map.Entry<String, List<String>> module : PACKAGES.entrySet()) {
            for (String packageName : module.getValue()) {
                Path dir = jrt.getPath("/modules", module.getKey(),
                        packageName.replace('.', '/'));
                if (!Files.isDirectory(dir)) {
                    continue;
                }
                try (Stream<Path> entries = Files.list(dir)) {
                    entries.map(p -> p.getFileName().toString())
                            .filter(n -> n.endsWith(".class") && !n.contains("$"))
                            .map(n -> packageName + "." + n.substring(0, n.length() - 6))
                            .forEach(classNames::add);
                }
            }
        }

        StringBuilder out = new StringBuilder("{\"classes\":[\n");
        boolean first = true;
        for (String className : classNames) {
            String json = describeClass(className);
            if (json != null) {
                if (!first) {
                    out.append(",\n");
                }
                out.append(json);
                first = false;
            }
        }
        out.append("\n]}\n");
        System.out.print(out);
    }

    private static String describeClass(String className) {
        Class<?> cls;
        try {
            cls = Class.forName(className, false, GenerateJdkIndex.class.getClassLoader());
        } catch (Throwable e) {
            return null;
        }
        if (!Modifier.isPublic(cls.getModifiers())) {
            return null;
        }

        String kind = cls.isAnnotation() ? "annotation"
                : cls.isInterface() ? "interface"
                : cls.isEnum() ? "enum" : "class";
        Class<?> superclass = cls.getSuperclass();

        List<String> fields = new ArrayList<>();
        for (Field field : cls.getDeclaredFields()) {
            if (!Modifier.isPublic(field.getModifiers()) || field.isSynthetic()) {
                continue;
            }
            fields.add(obj(
                    attr("name", field.getName()),
                    attr("type", erased(field.getType())),
                    genericAttr("genericType", pretty(field.getGenericType()),
                            erased(field.getType())),
                    attr("isStatic", Modifier.isStatic(field.getModifiers())),
                    attr("isPublic", true),
                    attr("isFinal", Modifier.isFinal(field.getModifiers())),
                    attr("isDeprecated", field.isAnnotationPresent(Deprecated.class))));
        }

        List<String> methods = new ArrayList<>();
        for (Constructor<?> constructor : cls.getDeclaredConstructors()) {
            if (!Modifier.isPublic(constructor.getModifiers()) || constructor.isSynthetic()) {
                continue;
            }
            methods.add(describeExecutable("<init>", "void", constructor.getParameters(),
                    constructor.getGenericParameterTypes(), null,
                    false, constructor.isAnnotationPresent(Deprecated.class)));
        }
        for (Method method : cls.getDeclaredMethods()) {
            if (!Modifier.isPublic(method.getModifiers()) || method.isSynthetic()
                    || method.isBridge()) {
                continue;
            }
            methods.add(describeExecutable(method.getName(), erased(method.getReturnType()),
                    method.getParameters(), method.getGenericParameterTypes(),
                    pretty(method.getGenericReturnType()),
                    Modifier.isStatic(method.getModifiers()),
                    method.isAnnotationPresent(Deprecated.class)));
        }

        return obj(
                attr("fqcn", cls.getName()),
                attr("packageName", cls.getPackageName()),
                attr("simpleName", cls.getSimpleName()),
                attr("kind", kind),
                attr("isPublic", true),
                attr("isAbstract", Modifier.isAbstract(cls.getModifiers())),
                attr("isDeprecated", cls.isAnnotationPresent(Deprecated.class)),
                superclass == null ? null : attr("superclass", superclass.getName()),
                "\"interfaces\":" + array(Stream.of(cls.getInterfaces())
                        .map(i -> quote(i.getName())).collect(Collectors.toList())),
                "\"fields\":" + array(fields),
                "\"methods\":" + array(methods));
    }

    private static String describeExecutable(String name, String returnType,
            Parameter[] parameters, Type[] genericParameterTypes, String genericReturn,
            boolean isStatic, boolean deprecated) {

        List<String> params = new ArrayList<>();
        List<String> genericParams = new ArrayList<>();
        List<String> erasedParams = new ArrayList<>();
        for (int i = 0; i < parameters.length; i++) {
            params.add(obj(
                    attr("name", parameters[i].getName()),
                    attr("type", erased(parameters[i].getType()))));
            genericParams.add(i < genericParameterTypes.length
                    ? pretty(genericParameterTypes[i])
                    : simple(erased(parameters[i].getType())));
            erasedParams.add(simple(erased(parameters[i].getType())));
        }

        String descriptor = "(" + Stream.of(parameters)
                .map(p -> erased(p.getType())).collect(Collectors.joining(","))
                + ")" + returnType;

        // Emit the generic form only when it differs from the erased one
        String genericSignature = null;
        if (genericReturn != null) {
            String generic = "(" + String.join(", ", genericParams) + ") : " + genericReturn;
            String erasedForm = "(" + String.join(", ", erasedParams) + ") : " + simple(returnType);
            if (!generic.equals(erasedForm)) {
                genericSignature = generic;
            }
        }

        return obj(
                attr("name", name),
                attr("descriptor", descriptor),
                attr("returnType", returnType),
                "\"parameters\":" + array(params),
                genericSignature == null ? null : attr("genericSignature", genericSignature),
                attr("isStatic", isStatic),
                attr("isPublic", true),
                attr("isDeprecated", deprecated));
    }

    /** Erased type name in the model.ts convention: FQCN, primitive or [] */
    private static String erased(Class<?> type) {
        if (type.isArray()) {
            return erased(type.getComponentType()) + "[]";
        }
        return type.getName();
    }

    /** Readable generic form with simple names, e.g. "List<String>" */
    private static String pretty(Type type) {
        return simple(type.getTypeName());
    }

    /** Drops the package qualifiers of a type name */
    private static String simple(String typeName) {
        return typeName.replaceAll("[A-Za-z_$][\\w$]*\\.", "").replace('$', '.');
    }

    ///////////////////////////////
    // Minimal JSON construction //
    ///////////////////////////////

    private static String obj(String... attributes) {
        return "{" + Stream.of(attributes).filter(a -> a != null)
                .collect(Collectors.joining(",")) + "}";
    }

    private static String array(List<String> items) {
        return "[" + String.join(",", items) + "]";
    }

    private static String attr(String name, String value) {
        return quote(name) + ":" + quote(value);
    }

    private static String attr(String name, boolean value) {
        return quote(name) + ":" + value;
    }

    private static String quote(String value) {
        StringBuilder sb = new StringBuilder("\"");
        for (int i = 0; i < value.length(); i++) {
            char c = value.charAt(i);
            switch (c) {
                case '"': sb.append("\\\""); break;
                case '\\': sb.append("\\\\"); break;
                case '\n': sb.append("\\n"); break;
                case '\r': sb.append("\\r"); break;
                case '\t': sb.append("\\t"); break;
                default:
                    if (c < 0x20) {
                        sb.append(String.format("\\u%04x", (int) c));
                    } else {
                        sb.append(c);
                    }
            }
        }
        return sb.append('"').toString();
    }

    private static String genericAttr(String name, String prettyValue, String erasedValue) {
        // Emit the generic form only when it differs from the erased type
        if (prettyValue == null || prettyValue.equals(simple(erasedValue))
                || prettyValue.equals(erasedValue)) {
            return null;
        }
        return attr(name, prettyValue);
    }
}
